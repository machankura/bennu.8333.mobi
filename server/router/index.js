const express = require("express")
const path = require("path")

module.exports = function () {
    var router = express.Router();

    router.route('/')
        .get(function(request, response, next)  {
            response.display("home", {
                pageTitle: "Bennu"
            })
        });

    router.route('/faqs')
        .get(function(request, response, next)  {
            response.display("faq", {
                pageTitle: "Frequently Asked Questions - Bennu"
            })
        });

    router.route('/brand')
        .get(function(request, response, next) {
            response.display("brand", {
                pageTitle: "Brand - Bennu"
            })
        });

    router.route('/playground')
        .get(function(request, response, next) {
            response.display("playground", {
                pageTitle: "Playground - Bennu"
            })
        });

    // The icon links in the layout cover every browser that reads them, but a
    // bare /favicon.ico is still asked for before any markup is parsed.
    router.route('/favicon.ico')
        .get(function(request, response, next)  {
            response.sendFile(
                path.resolve("server/static/img/icon/favicon.ico")
            )
        });

    // 404 pages...
    router.use((request, response, next) => {

        if(!response.headersSent) {
            response.status(404);

            if (request.accepts('html')) {
                response.display("404", {
                    pageTitle: "Page Not Found - Bennu"
                })
                return;
            }

            response.type('txt').send('Resource Not found');
        }
    });

    // 500 pages...
    router.use((error, request, response, next) => {

        if(error && !response.headersSent) {
            console.error("We have an error: ", error)
            response.status(500);

            if (request.accepts('html')) {
                response.display("error", {
                    pageTitle: "Internal Error - Bennu",
                    error: error
                })
                return;
            }

            response.type('txt').send('Internal error');
        }
    });

    return router;
};
