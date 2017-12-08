**sigfox-iot-cloud** is a cloud-agnostic software framework for building a
Sigfox server with Amazon Web Services and Google Cloud Platform.

More details:

1. [`sigfox-aws`:](https://www.npmjs.com/package/sigfox-aws)
    Software framework for building a Sigfox server with **Amazon Web Services Lambda Functions**, **AWS IoT Rules**
    and **AWS IoT MQTT** message queues:

2. [`sigfox-gcloud`:](https://www.npmjs.com/package/sigfox-gcloud)
    Software framework for building a Sigfox server with **Google Cloud Functions** and **Google Cloud PubSub** message queues

Adapter Modules may be built with the `sigfox-iot-cloud` framework for processing Sigfox messages on `sigfox-aws` / `sigfox-gcloud`. Available modules:

1. [`sigfox-iot-ubidots`:](https://www.npmjs.com/package/sigfox-iot-ubidots)
    Adapter for integrating Sigfox devices with the easy and friendly **Ubidots IoT platform**

2. [`sigfox-iot-data`:](https://www.npmjs.com/package/sigfox-iot-data)
    Adapter for writing Sigfox messages into SQL databases like **MySQL, Postgres, MSSQL, MariaDB and Oracle**
