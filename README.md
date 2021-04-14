AKS and Cosmos DB Scaling DEMO
==============================

Demo uses:
- AKS
- Nginx
- Cosmos DB
- Hey, for loadtesting [https://github.com/rakyll/hey]

Assumptions:
- This demo assumes that you have created a DNS zone for the ingress controller and that you have a working Cosmos DB account setup using the SQL (Core) API.

Also shows:
- TLS using Let's Encrypt certificates with Cert-Manager

Steps
-----

### Create AKS cluster and ACR (optional)

Follow these steps to create an AKS cluster: https://docs.microsoft.com/en-us/azure/aks/kubernetes-walkthrough

**TL;DR steps:**

```sh
RESOURCE_GROUP=<myresourcegroup>
LOCATION=australiaeast
ACR_NAME=<myacrname>
CLUSTER_NAME=traefikdemo
AKS_VERSION=1.19.9
NODE_COUNT=3

az group create -n ${RESOURCE_GROUP} -l ${LOCATION}
az acr create -g ${RESOURCE_GROUP} -n ${ACR_NAME} --sku Basic
ACR_ID=$(az acr show -g ${RESOURCE_GROUP} -n ${ACR_NAME} --query id -o tsv)

az aks create \
  -g ${RESOURCE_GROUP} \
  -n ${CLUSTER_NAME} \
  -c ${NODE_COUNT} \
  -k ${AKS_VERSION} \
  --attach-acr ${ACR_ID} \
  -a monitoring \
  --generate-ssh-keys

sudo az aks install-cli # if you don't have `kubectl` installed
az aks get-credentials -g ${RESOURCE_GROUP} -n ${CLUSTER_NAME}
```

### Update Cosmos DB configuration
Update the connection and key access information config.yaml and CosmosDB Host and CosmoDB Key in the deployment yaml.

### Install Nginx Ingress via Helm into the cluster

**Install Helm**

See: https://helm.sh/docs/intro/install/

```sh
curl -fsSL -o get_helm.sh https://raw.githubusercontent.com/helm/helm/master/scripts/get-helm-3
chmod 700 get_helm.sh
./get_helm.sh
```

Using Helm, install the Nginx Ingress chart:
```sh
kubectl create namespace ingress
helm repo add stable https://kubernetes-charts.storage.googleapis.com/
helm repo add ingress-nginx https://kubernetes.github.io/ingress-nginx
helm repo update

helm install nginx-ingress ingress-nginx/ingress-nginx \
    --namespace ingress \
    --set controller.replicaCount=2 \
    --set controller.nodeSelector."beta\.kubernetes\.io/os"=linux \
    --set defaultBackend.nodeSelector."beta\.kubernetes\.io/os"=linux \
    --set controller.admissionWebhooks.patch.nodeSelector."beta\.kubernetes\.io/os"=linux

# Wait for the external IP to be assigned by watching the Nginx service (CTRL+C to exit)
# To get the public IP address, use the kubectl get service command
kubectl get services -n ingress -o wide -w nginx-ingress-ingress-nginx-controller

# Wait for the Ngnix pod to be 'Running' (CTRL+C to exit)
kubectl get pod -n ingress -w
```

### Set DNS name for the public IP of the Nginx controller:

Get the IP address of the Nginx ingress controller service using kubectl get.

```sh
kubectl get svc nginx-ingress-ingress-nginx-controller -n ingress
# *** EXTERNAL IP  ***
# *** XXX.XX.XX.XX ***
```

Update the DNS name for the public IP of the Nginx ingress

```sh
# Public IP address
IP="<your_public_ip>"

# Name to associate with public IP address
DNSNAME=<unique-prefix-name> # e.g. traefik7242

# Get the resource-id of the public ip
PUBLICIPID=$(az network public-ip list --query "[?ipAddress!=null]|[?contains(ipAddress, '$IP')].[id]" --output tsv)

# Update public ip address with dns name
az network public-ip update --ids $PUBLICIPID --dns-name $DNSNAME
```

### Check that your DNS / A Recording are returning valid results

```sh
dig <DNSNAME>.<LOCATION>.cloudapp.azure.com
# or 
dig <zone.domain.com> #aksscaledemo.griffinbird.com
```

### Deploy a sample app that uses Nginx ingress
Add an A record to your DNS zone with the external IP address of the Nginx service using

```sh
az network dns record-set a add-record \
    --resource-group myResourceGroup \
    --zone-name MY_CUSTOM_DOMAIN \
    --record-set-name * \
    --ipv4-address MY_EXTERNAL_IP
```

Retrieve FQDN (`<DNSNAME>.<LOCATION>.cloudapp.azure.com`) mapped to the Ingress controller's public IP:

```sh
az network public-ip show --ids $PUBLICIPID --query dnsSettings.fqdn -o tsv
# DNSNAME.LOCATION.cloudapp.azure.com
```

Update the host field in the Ingress resource of `ingress.yaml` to match your Nginx public IP FQDN retrieve above:

```yaml
  host: <DNSNAME>.<LOCATION>.cloudapp.azure.com
```

### Label the ingress-basic namespace to disable resource validation
```sh
kubectl label namespace ingress-basic cert-manager.io/disable-validation=true
```
### Add the Jetstack Helm repository
```sh
helm repo add jetstack https://charts.jetstack.io
```
### Update your local Helm chart repository cache
```sh
helm repo update
```

### Install the cert-manager Helm chart
```sh
helm install cert-manager jetstack/cert-manager \
  --namespace cert-manager \
  --set installCRDs=true \
  --set nodeSelector."kubernetes\.io/os"=linux \
  --set webhook.nodeSelector."kubernetes\.io/os"=linux \
  --set cainjector.nodeSelector."kubernetes\.io/os"=linux
```

### Create a CA cluster issuer

```sh
kubectl apply -f cluster-issuer.yaml
```

### Create an ingress route

kubectl apply -f ingress.yaml -n ingress

# Verify a certificate object has been created
kubectl get certificate -n ingress

### Deploy Promtheus-Operator
```sh
# See: https://github.com/prometheus-operator/prometheus-operator
helm repo update
helm repo add stable https://charts.helm.sh/stable
helm repo update
kubectl create ns prometheus-operator
helm upgrade --install prometheus-operator stable/prometheus-operator \
    --namespace prometheus-operator \
    --set prometheus.prometheusSpec.serviceMonitorSelector=""

# TODO: Prometheus node-exporters keep targetting Windows nodes even though they are tainted - need to fix this.

# Edit serviceMonitorSelector to look like this:
#   serviceMonitorNamespaceSelector: {}
#   serviceMonitorSelector: {}
kubectl edit prometheus -n prometheus-operator -o yaml
# TODO: Not sure how to set this via the helm --set parameter, so that's why we edit it here after installation.
kubectl get all -n prometheus-operator
```

### Deploy the sample app resources:

```sh
kubectl create ns nodeapp
kubectl apply -f deployment.yaml -n nodeapp
```

Wait until all resources have been created:

```sh
kubectl get all -n nodeapp
```

Browse to: https://DNSNAME.LOCATION.cloudapp.azure.com

The TLS certificate should be valid in your browser.

### Generating Load for the application and monitoring
```sh
hey -z 15m http://aksscaledemo.griffinbird.com
```
Get HPA started:
```sh
kubectl apply -f hpa.yaml
```
Monitor what is happening:
```sh 
kubectl get nodes -l agentpool=canp
kubectl describe hpa -n nodeapp nodeapp
kubectl get pods -n nodeapp
```
In another bash prompt:
```sh
kubectl port-forward service/prometheus-operator-grafana 8080:80 -n prometheus-operator
```
### Configure Grafana Dashboard
```sh
#TODO
```
- Go to localhost:8080
- Enter user/pass
- Upload grafan.json
- Load dashboard
- 

### Troubleshooting

* Ensure you updated the placeholder values in any input files
* Ensure you use unique domain names
* Ensure your email for Let's encrypt is valid
* For Nginx or Let's Encrypt issues, check the logs on your Nginx pod:

```sh
kubectl get pods -n ingress
kubectl logs nginx-ingress-ingress-nginx-controller-6c576f944b-xlvnv -n ingress
```

### Resources / Credits

* https://github.com/nginxinc/helm-charts
* https://docs.microsoft.com/en-us/azure/aks/ingress-tls
* https://letsencrypt.org/docs/challenge-types/
* https://kubernetes.io/docs/concepts/services-networking/ingress/
* https://kubernetes.github.io/ingress-nginx/user-guide/nginx-configuration/annotations/
* https://kubernetes.github.io/ingress-nginx/examples/auth/basic/