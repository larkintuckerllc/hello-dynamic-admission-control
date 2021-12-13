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
      namespace,
      object: {
        labels,
        metadata: { annotations },
        spec: { volumes },
      },
      uid,
    },
  } = req.body;
  if (
    dryRun ||
    annotations == undefined ||
    annotations["volume-claim-template/name"] == undefined ||
    annotations["volume-claim-template/storage"] == undefined
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
      name: uid,
      namespace,
    },
    spec: {
      accessModes: ["ReadWriteOnce"],
      storageClassName: "standard-rwo",
      resources: {
        requests: {
          storage: annotations["volume-claim-template/storage"],
        },
      },
    },
  };
  k8sApi
    .createNamespacedPersistentVolumeClaim(namespace, pvc)
    .then(() => {
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
        if (volumes[i].name == annotations["volume-claim-template/name"]) {
          success = true;
          volumes[i] = {
            name: annotations["volume-claim-template/name"],
            persistentVolumeClaim: {
              claimName: uid,
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
      const jsonPatch = [];
      if (labels == undefined) {
        jsonPatch.push({
          op: "add",
          path: "/metadata/labels",
          value: {
            'volume-claim/name': uid,
          },
        });
      } else {
        jsonPatch.push({
          op: "replace",
          path: "/metadata/labels",
          value: { ...labels, 'volume-claim/name': uid },
        });
      }
      jsonPatch.push({
        op: "replace",
        path: "/spec/volumes",
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
