/*var Promise = require("bluebird"),  
request = require('request'),  
WP = require( 'wordpress-rest-api' ), 
fs = require('fs'),
moment = require('moment'),
handlebars = require('handlebars'),
handbrake = require("handbrake-js"),
config = require('config'),
exif = require('exiftool');

var rp = require('request-promise').defaults({ 
	jar: true 
	, simple: false
	, resolveWithFullResponse: true
	 ,followAllRedirects: false
	 , followRedirect: false
});
*/


/*
getFiles('gopro').download().getFiles('c:/temp').examine().convert().upload().summarise().

promise of files.then

*/


function isFunction(functionToCheck) {
 var getType = {};
 return functionToCheck && getType.toString.call(functionToCheck) === '[object Function]';
}

//these return promises of an array files...
var fileGetters = {
    'fake' : function(){
        return [
            {url:'http://itsupport/test/blah.mp4'}
            ,{url:'http://itsupport/test/blahBLAH.mp4'}
        ];
    }
}; 

var makeJob = function(spec){

    var filePromises = [];
    
    var addFiles = function(f){
        
        var func = isFunction(f) ? f : fileGetters[f];
        var files = func();
        files.forEach(function(f){
            filePromises.push(Promise.resolve(f));
        });
        return api;
    };
    var getFiles = function(){
        return filePromises;
    };
    
    var fileProc = function(func){
        return function(){
            filePromises.forEach(function(fp,i){
                filePromises[i] = fp.then(
                    function(f){
                        func(f);
                        return f;
                    }
                );
            });
            return api;   
        }
    }
    
    var download = fileProc(function(f){
        f.localpath = 'c:/temp/test.mp4';
        //return f;
    });
    
    var convert = fileProc(function(f){
        f.convertedpath = f.localpath + '.converted';
        //return f;
    });
    
    var upload = fileProc(function(f){
        f.uploadedpath = 'http://wp/blahconv.mp4';
        //return f;
    });
    var log = fileProc(function(f){
        console.log(f);
        //return f;
    });   

    var makePage = function(){
        Promise.all(filePromises).then(function(res){
            console.log("making page: ",res);
        });
    };
    
    //var files ; //this needs to run all the file get jobs using promise.all`
    // then allow promises to be thenned on to the result for each file.
    
    //var job;   //this needs to 
    
    var api = {
        addFiles: addFiles
        ,download: download
        ,getFiles: getFiles
        ,convert: convert
        ,upload: upload
        ,log:log
        ,makePage:makePage
        //,files: {
        //    download: downloadFile
        //}
    };
    
    return api;
    
};

module.exports = makeJob();