const config = require('config');
const express = require('express');
const path = require("path");
const fs = require('fs');
const pug = require("pug");

module.exports = function () {
    var server = {};

    server.run = () => {
        console.log("Starting Server")
        return new Promise(async (resolve, reject) => {
            const app = express();

            app.set("view engine", "pug");
            app.set("views", path.resolve("server/views"));

            // compile pug views below so that they are rendered quicker
            var pugPages = {};

            var modelDir = path.join(__dirname, './views');
            fs.readdirSync(modelDir)
                .filter(file => {
                    return file.endsWith(".pug");
                })
                .forEach(file => {
                    const name = file.split(".pug")[0];

                    pugPages[name] = pug.compileFile(path.join(modelDir, file))
                });

            // Set up middleware to make use of the compiled pugjs views
            app.use((request, response, next) => {
                // This is cheating...
                response.display = (view, options) => {
                    // Set a default pageTitle...
                    options.pageTitle = options.pageTitle ? options.pageTitle : "Bennu";
                    if(config.get("server.compiled-render")) {
                        if(pugPages[view]) {
                            response.send(pugPages[view](options))
                        } else {
                            response.send(pugPages["404"](options))
                        }
                    } else {
                        response.render(view, options);
                    }
                }
                next();
            })

            app.use('/static', express.static("server/static"));

            var router = require('./router/index.js')();
            app.use('/', router);

            const port = process.env.PORT || config.get("server.port");

            app.listen(port);
            resolve(port);
        });
    }

    return server;
};
