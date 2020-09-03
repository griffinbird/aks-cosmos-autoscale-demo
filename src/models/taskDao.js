// @ts-check
const CosmosClient = require('@azure/cosmos').CosmosClient
const debug = require('debug')('todo:taskDao')

const promClient = require('prom-client')

const queryHistogram = new promClient.Histogram({
    name: 'cosmos_task_query_duration',
    help: 'Duration of CosmosDB queries',
    labelNames: ['method']
});

const throttleCounter = new promClient.Counter({
  name: 'cosmos_throttle_count',
  help: 'Cosmos throttle count'
});

// For simplicity we'll set a constant partition key
const partitionKey = undefined
class TaskDao {
  /**
   * Manages reading, adding, and updating Tasks in Cosmos DB
   * @param {CosmosClient} cosmosClient
   * @param {string} databaseId
   * @param {string} containerId
   */
  constructor(cosmosClient, databaseId, containerId) {
    this.client = cosmosClient
    this.databaseId = databaseId
    this.collectionId = containerId

    this.database = null
    this.container = null
  }

  async init() {        
    debug('Setting up the database...')
    const dbResponse = await this.client.databases.createIfNotExists({
      id: this.databaseId
    })
    this.database = dbResponse.database
    debug('Setting up the database...done!')
    debug('Setting up the container...')
    const coResponse = await this.database.containers.createIfNotExists({
      id: this.collectionId
    })
    this.container = coResponse.container
    debug('Setting up the container...done!')    
    
  }

  async find(querySpec) {        
    debug('Querying for items from the database')
    if (!this.container) {
      throw new Error('Collection is not initialized.')
    }
        
    try {             
        const end = queryHistogram.startTimer( { method: 'query' });
        const { resources } = await this.container.items.query(querySpec).fetchAll()
        const seconds = end();
        return resources
    }
    catch(ex) {       
        if(ex.code == "429") {
            debug('Received a 429')
            throttleCounter.inc();
        }
    }  
  }

  async addItem(item) {
    debug('Adding an item to the database')
    item.date = Date.now()
    item.completed = false
    const end = queryHistogram.startTimer( { method: 'add' });
    const { resource: doc } = await this.container.items.create(item)
    const seconds = end();
    return doc
  }

  async updateItem(itemId) {
    debug('Update an item in the database')
    const doc = await this.getItem(itemId)
    doc.completed = true

    const { resource: replaced } = await this.container
      .item(itemId, partitionKey)
      .replace(doc)
    return replaced
  }

  async getItem(itemId) {
    debug('Getting an item from the database')
    const { resource } = await this.container.item(itemId, partitionKey).read()
    return resource
  }
}

module.exports = TaskDao