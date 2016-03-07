var job= require("../videoproc.js");

job
    .addFiles('fake')
    .addFiles('fake')
    .download()
    .log()
    .convert()
    .upload()
    .log()
    .makePage()
    ;
