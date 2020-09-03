const CosmosClient = require('@azure/cosmos').CosmosClient
const RetryOptions = require('@azure/cosmos').RetryOptions

const config = require('./config')
const TaskList = require('./routes/tasklist')
const TaskDao = require('./models/taskDao')

const express = require('express')
const path = require('path')
const logger = require('morgan')
const cookieParser = require('cookie-parser')
const bodyParser = require('body-parser')

const promClient = require('prom-client')
const taskListRequestCount = new promClient.Counter({
  name: "task_list_request_total",
  help: "Total number of requests to the task API"
});

//  const register = new promClient.Registry();
const app = express()
const metrics = express()

// view engine setup
app.set('views', path.join(__dirname, 'views'))
app.set('view engine', 'jade')

// uncomment after placing your favicon in /public
//app.use(favicon(path.join(__dirname, 'public', 'favicon.ico')));
app.use(logger('dev'))
app.use(bodyParser.json())
app.use(bodyParser.urlencoded({ extended: false }))
app.use(cookieParser())
app.use(express.static(path.join(__dirname, 'public')))



//Todo App:
const cosmosClient = new CosmosClient({
  endpoint: config.host,
  key: config.authKey,
  connectionPolicy: 
    { 
      RetryOptions: 
      {
        maxRetryAttemptCount: 0,
        maxWaitInSeconds: 0
      } 
    }
})
const taskDao = new TaskDao(cosmosClient, config.databaseId, config.containerId)
const taskList = new TaskList(taskDao)
taskDao
  .init(err => {
    console.error(err)
  })
  .catch(err => {
    console.error(err)
    console.error(
      'Shutting down because there was an error setting up the database.'
    )
    process.exit(1)
  })

app.get('/', (req, res, next) => {
  taskListRequestCount.inc();
  taskList.showTasks(req, res).catch(next);
});

app.post('/addTask', (req, res, next) => taskList.addTask(req, res).catch(next))
app.post('/completeTask', (req, res, next) => {
  taskListRequestCount.inc();
  taskList.completeTask(req, res).catch(next);
});

metrics.get('/metrics', async (req, res) => {
	try {
		res.set('Content-Type', promClient.register.contentType);
    res.end(await promClient.register.metrics());
	} catch (ex) {
		res.status(500).end(ex);
	}
});

app.set('view engine', 'jade')

// catch 404 and forward to error handler
app.use(function(req, res, next) {
  const err = new Error('Not Found')
  err.status = 404
  next(err)
})

// error handler
app.use(function(err, req, res, next) {
  // set locals, only providing error in development
  res.locals.message = err.message
  res.locals.error = req.app.get('env') === 'development' ? err : {}

  // render the error page
  res.status(err.status || 500)
  res.render('error')
})

module.exports = app

metrics.listen(3001, () => {
  console.log("Started metrics server on port 3001")
});