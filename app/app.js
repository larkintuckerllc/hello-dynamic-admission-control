const bodyParser = require('body-parser');
const express = require('express');
const fs = require('fs');
const https = require('https');

const app = express();
app.use(bodyParser.json());
const port = 8443;

const options = { 
  ca: fs.readFileSync('ca.crt'), 
  cert: fs.readFileSync('server.crt'), 
  key: fs.readFileSync('server.key'), 
}; 

app.get('/hc', (req, res) => {
  res.send('ok');
});

app.post('/', (req, res) => {
  if (
    req.body.request === undefined ||
    req.body.request.uid === undefined
  ) {
    res.status(400).send();
    return;
  }
  // TODO: THINGS IN SEPARATE CONTROLLER
  // TODO: - NEED TO RECONCILE IF THE POD IS NOT CREATED
  // TODO: - NEED TO DELETE PVC WHEN DELETING POD
  console.log(req.body.request.object)
  const { request: { dryRun, object: { metadata: { annotations } }, uid } } = req.body;
  if (annotations == undefined || annotations.pvc == undefined) {
    res.send({
      apiVersion: 'admission.k8s.io/v1',
      kind: 'AdmissionReview',
      response: {
        uid,
        allowed: true,
      },
    });
    return;
  }
  if (!dryRun) {
    // TODO: NEED PERMISSIONS TO CREATE PVC
    // TODO: NEED TO CREATE PVC
    console.log('DO IT');
  }
  // TODO: NEED TO ATTACH PVC TO POD
  const jsonPatch = [{
    op: 'add',
    path: '/metadata/labels',
    value: { 'hello': 'world' },
  }];
  const jsonPatchString = JSON.stringify(jsonPatch);
  const jsonPatchBuffer = Buffer.from(jsonPatchString);
  const patch = jsonPatchBuffer.toString('base64');
  res.send({
    apiVersion: 'admission.k8s.io/v1',
    kind: 'AdmissionReview',
    response: {
      uid,
      allowed: true,
      patchType: 'JSONPatch',
      patch,
    },
  });
});

const server = https.createServer(options, app);

server.listen(port, () => {
  console.log(`Server running on port ${port}/`);
});
