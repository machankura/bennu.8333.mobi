const server = require('./server/server.js')();

server.run().then((port) => {
    console.log("Server is running on: ", port);
})
.catch((error) => {
    console.error("Failed to run server: ", error);
})
