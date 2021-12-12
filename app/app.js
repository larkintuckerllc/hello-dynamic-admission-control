const bodyParser = require("body-parser");
const express = require("express");
const fs = require("fs");
const https = require("https");
const k8s = require("@kubernetes/client-node");

const kc = new k8s.KubeConfig();
kc.loadFromDefault();
const k8sApi = kc.makeApiClient(k8s.CoreV1Api);

const app = express();
app.use(bodyParser.json());
const port = 8443;

const options = {
  ca: fs.readFileSync("ca.crt"),
  cert: fs.readFileSync("server.crt"),
  key: fs.readFileSync("server.key"),
};

app.get("/hc", (req, res) => {
  res.send("ok");
});

app.post("/", (req, res) => {
  if (req.body.request === undefined || req.body.request.uid === undefined) {
    res.status(400).send();
    return;
  }
  const {
    request: {
      dryRun,
      object: {
        metadata: { annotations, name, namespace, },
        spec: { volumes, }
      },
      uid,
    },
  } = req.body;
  if (dryRun || annotations == undefined ||
    annotations['volume-claim-template/name'] == undefined ||
    annotations['volume-claim-template/storage'] == undefined
    ) {
    res.send({
      apiVersion: "admission.k8s.io/v1",
      kind: "AdmissionReview",
      response: {
        uid,
        allowed: true,
      },
    });
    return;
  }
  const pvc = {
    metadata: {
      name,
    },
    spec: {
      accessModes: ["ReadWriteOnce"],
      storageClassName: "standard-rwo",
      resources: {
        requests: {
          storage: annotations['volume-claim-template/storage'],
        },
      },
    },
  };
  k8sApi
    .createNamespacedPersistentVolumeClaim(namespace, pvc)
    .then(() => {
      const jsonPatch = [];
      if (volumes == undefined) {
        res.send({
          apiVersion: "admission.k8s.io/v1",
          kind: "AdmissionReview",
          response: {
            uid,
            allowed: false,
          },
        }); 
        return;
      }
      let success = false;
      for (let i = 0; i < volumes.length; i++) {
        if (volumes[i].name == annotations['volume-claim-template/name']) {
          success = true;
          volumes[i] = {
            name: annotations['volume-claim-template/name'],
            persistentVolumeClaim: {
              claimName: name,
            },
          };
        }
      }
      if (!success) {
        res.send({
          apiVersion: "admission.k8s.io/v1",
          kind: "AdmissionReview",
          response: {
            uid,
            allowed: false,
          },
        }); 
        return;
      }
      jsonPatch.push({
        op: 'replace',
        path: '/spec/volumes',
        value: volumes,
      });
      const jsonPatchString = JSON.stringify(jsonPatch);
      const jsonPatchBuffer = Buffer.from(jsonPatchString);
      const patch = jsonPatchBuffer.toString("base64");
      res.send({
        apiVersion: "admission.k8s.io/v1",
        kind: "AdmissionReview",
        response: {
          uid,
          allowed: true,
          patchType: "JSONPatch",
          patch,
        },
      });
    })
    .catch(() => {
      res.send({
        apiVersion: "admission.k8s.io/v1",
        kind: "AdmissionReview",
        response: {
          uid,
          allowed: false,
        },
      });
    });
});

const server = https.createServer(options, app);

server.listen(port, () => {
  console.log(`Server running on port ${port}/`);
});
