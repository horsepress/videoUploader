"use strict";

var Promise = require("bluebird"),  
request = require('request'),  
WP = require( 'wordpress-rest-api' ), 
fs = require('fs'),
moment = require('moment'),
handlebars = require('handlebars'),
handbrake = require("handbrake-js"),
config = require('config');
var exif = require('exiftool');

var rp = require('request-promise').defaults({ 
	jar: true 
	, simple: false
	, resolveWithFullResponse: true
	 ,followAllRedirects: false
	 , followRedirect: false
}); 
 
var DOWNLOADDIR = config.downloadDirectory;

var args = process.argv; 
//PWD = args[2];
//var pagetitle = args[3] || 'New Post';

//console.log(day, monthNames[monthIndex], year);
var formattedDate = moment().format('DDMMMYYYY');
var pagetitle = args[2] || formattedDate + ' notes';
console.log(pagetitle);
//process.argv.forEach(function (val, index, array) { console.log(index + ': ' + val);}); 
 

 

console.log("about to connect to WP"); 
var wp = new WP({
    endpoint: config.wordpress.endpoint,
    // This assumes you are using basic auth, as described further below
    username: config.wordpress.username,
    password: config.wordpress.password
});
 
console.log("after connect to WP");

//process.exit(0);

(function(){
	switch (config.source.toLowerCase()){
		case "gopro":
			return getSourceFilesGoPro();
			break;
		case "dir":
			return getSourceFilesDir();
			break;
		case "iphone":
			return getSourceFilesIphone2();
			break;
		default:
			return getSourceFiles()
	}
})()
.then(function(files){
	console.log(files);
	processVideos(pagetitle,files);
});



//this function controls the running order
function processVideos(pageName,sourceFiles){
	
	console.log("starting process videos");
	
	var processPromises = [];

	processPromises = sourceFiles.map(function(f,index){
		
		return Promise.resolve(true) 
			.then(function(){
				if (config.operations.download != true || f.cameraFileURL == false ){
					// seems to help to put a delay here so that the handbrake conversions don't all start together
					return delay(index * 2000).then(function(){return Promise.resolve(f.downloadFilename);});
				} else {
					return downloadFile(f.cameraFileURL, f.downloadFilename);
				}
			})
			.then(function(downloadedFile){
				return (config.operations.convert == true) ? covertVideo(downloadedFile, f.destFilePath) : Promise.resolve(f.destFilePath);
			})
			.then(function(convertedFile){
				return (config.operations.upload == true) ? uploadFileToWordpress(convertedFile,f.destWPfile) : Promise.resolve(false);
			})
		;
	});
	
	Promise.all(processPromises)
	.then(function(resArray){
		
		if (resArray == false || config.operations.makepage != true){return Promise.resolve(false);}
		
		//resArray contains results of uploads to WP. 
		//get an array of file names from it for use in the new page
		var files = resArray.map(function(res){
			var body={};
			try{
				body = JSON.parse(res.body);
			} catch(e){
				console.log("failed to parse res body!",e);
				return 'unknown.mp4';
			}
			return body.source_url || 'sourceurlnotfound.mp4';
		});
		
		//console.log(files.join("\n"));
		
		return createWordPressPage(pageName, files);
	})
	.then(function(res) {
		if (res == false){return Promise.resolve(false);}
		console.log("Page id: %s, title: %s, link: %s", res.id, res.title.raw,res.link);
		console.log("Files converted and uploaded successfully.");
	})
	.catch(function(err) {
		console.log(err);
		console.error("Finished. errors occured");
	})
	;	
} 
 
//this downloads a file from a URL and saves it somewhere
function downloadFile(sourceUrl, destPath){
	return new Promise (function(resolve,reject){
		var filename = sourceUrl.replace(/.*\/(.*?)/,"$1");    //get the source filename only
		request.get( sourceUrl )
		.on( 'response', function( res ){
			console.log("downloading from " + sourceUrl);
			//extract filename
			//var filename = regexp.exec( res.headers['content-disposition'] )[1];

            var len = parseInt(res.headers['content-length'], 10);
            var cur = 0;
            var total = len / 1048576; //1048576 - bytes in  1Megabyte
			var count = 0;
			
			// create file write stream
			var fws = fs.createWriteStream( destPath );

			res.pipe( fws );

            res.on("data", function(chunk) {
				count = count +1;
                cur += chunk.length;
                if (count % 1000 ===0){
					console.log( "Downloading %s: %s% (%s of %s Mb)" , filename,(100 * cur / len).toFixed(1), (cur / 1048576).toFixed(1), total.toFixed(1) );
				}
            });					
			
			res.on( 'end', function(){
			  resolve(destPath);
			});
		});
	});
}


function delay(time) {
  return new Promise(function (fulfill) {
    setTimeout(fulfill, time);
  });
}

//this converts a video to a web friendly size using handlebars
function covertVideo(sourcePath, destPath){
	return new Promise (function(resolve,reject){
		console.log("coverting: "+ sourcePath);
		var count =-1;
		
		//getVideoMetadata(sourcePath)
		Promise.resolve({rotation:0})
		.then(function(metadata){

			//get handbrake config
			var handbrakeConfig = config.handbrakeConfig;
			handbrakeConfig.input = sourcePath;
			handbrakeConfig.output = destPath;

			//sort rotation
			if (metadata.error){console.log("Metadata error ",metadata.error);metadata.rotation = 0;}
			console.log("Metadata rotation is: %s deg",metadata.rotation);

			if (metadata.rotation != 0 && (handbrakeConfig.rotate == undefined || handbrakeConfig.rotate == 'auto' )){
				var rotValues = {"180":3, "90":4, "270":7, "0":0 };
				var rotValue = rotValues[metadata.rotation.toString()];
				if (rotValue  != undefined){	handbrakeConfig.rotate = rotValue; }
			} 
			console.log("handbrake config rotation: " , handbrakeConfig.rotate )
			
			//run convert
			handbrake.spawn(handbrakeConfig)
			.on("error", function(err){
				console.log("handbrake error " + sourcePath);
				reject(err);
			})
			.on("progress", function(progress){
				count = (count + 1) % 20;   //reduce amount of progress reported
				if (count===0){
					console.log( "Converting %s: %s%, ETA: %s",sourcePath,progress.percentComplete,  progress.eta);
				}
			})
			.on("end", function(){
				resolve(destPath);
			});	
		});
	});
}


function createWordPressPage(title,videos){
	
	//get rid of domain - saves hassle in case of changes
	videos = videos.map(function(v){
		return v.replace(/https?:\/\/[^\/]+/,'');
	});
	
	//make text for page by joining video titles
	var compiledTemplate = handlebars.compile(fs.readFileSync("templates/video.hbs","utf8"));
	var text = compiledTemplate({'videos':videos});
	
	console.log("Attempting to create page: " + title);
	
	//set a page creation request to WP API
	return wp.posts().post({
		// "title" and "content" are the only required properties
		title: title
		,content: text
		// Post will be created as a draft by default if a specific "status"
		// is not specified
	   //status: 'publish'
	});
}


// useful for writing out responses in case of problems
function writefile(name,text){
	fs.writeFile(name, text, function(err) {
		if(err) {
			return console.log(err);
		}

		console.log(name + " was saved!");
	}); 
}

function getVideoMetadata(videoPath){
	return new Promise (function(resolve,reject){
		//var defaultMetaData = {er};
		fs.readFile(videoPath, function (err, data) {
			if (err) {
				resolve({'error':err});
				//reject(err);
			}
			
			/*
			  need to add this error handler to exiftool.js to stop it throwing unhandled errors on some files:
			  exif.stdin.on("error", function (data) {errorMessage += data.toString(); });
			*/
			exif.metadata(data, function (err, metadata) {
				if (err){
					resolve({'error':err});
					//reject(err);
				}
				resolve(metadata);			
			});
		});	
	});
};

function uploadFileToWordpress(filePath,title){
	console.log("uploading");
	return rp.post({
		url:config.wordpress.endpoint + '/media'
		,formData: {
			file: fs.createReadStream(filePath)
			,title: title
		}
		,auth: {
			'user': config.wordpress.username,
			'pass': config.wordpress.password,
			'sendImmediately': true
		}
	});
} 

// ===========


/**
 * This queries a goPro camera returns an array of objects describing files to download and process
 * 
*/
function getSourceFilesGoPro(gpurl){
	gpurl = gpurl || 'http://10.5.5.9/videos/DCIM/100GOPRO/';     //this is the default gopro url
	var files;
	
	return new Promise (function(resolve,reject){
		rp({url:gpurl})
		.then(function(res){
			//writefile('C:/temp/tango/gopro.html',res.body);
			//put out *.MP4 links
			files = res.body.match(/<a class="link" href="[A-Z0-9]+\.MP4">([A-Z0-9]+\.MP4)<\/a>/ig);
			
			files = files.map(function(f,index){
				//keep the filename only
				var filename = f.replace(/<.*>(.*).MP4<\/.*>/i,'$1');
				var convfilename = formattedDate + '_' + (args[index + 3] || '') + '_' + filename; 
				//make object to return with various paths specified
				return {
					cameraFileURL: gpurl + filename + '.MP4'
					,downloadFilename: DOWNLOADDIR + filename + '.mp4'
					, destFilePath:  DOWNLOADDIR + convfilename  + ".mp4"
					, destWPfile:convfilename + ".mp4"
				};
			});
			//console.log(files);
			resolve(files);	
		})
		.catch(function(err){
			reject(err);
		})
		;
	});
} 

function getSourceFilesDir(path){
	path = path || config.sourceDirectory || DOWNLOADDIR;     //get directory for files
	var files;
	
	return new Promise (function(resolve,reject){
		fs.readdir(path, function(err,files){
			if (err){reject(err);}
			console.log(files);
			files = files.filter(function (file) {
				return fs.statSync(path +'/' + file).isFile();
			})
			.map(function(f,index){
				//keep the filename only
				var filenameWithExtension = f;
				var filenameNoExtension = f.replace(/^(.*)\..*?$/i,'$1');
				var convfilename = formattedDate +  (args[index + 3] ? '_' + args[index + 3] : '') + '_' + filenameNoExtension; 
				//make object to return with various paths specified
				return {
					cameraFileURL: false
					,downloadFilename: path + '/' + filenameWithExtension
					, destFilePath: DOWNLOADDIR + convfilename  + ".mp4"
					, destWPfile: convfilename  + ".mp4"
				};
			});			
			
			resolve(files);
		});	
	});
} 

function getSourceFilesIphone2(url,dateAfter, dateBefore/*, minLengthSeconds*/){
	url = url || 'http://192.168.232.71:8080/webselector/album_page/E112D0E6-D2EA-43E8-A086-B8C6765ED4DC%2FL0%2F040/0/99';    // ;'http://itsupport/test/album.html';     //http://192.168.232.71:8080/webselector/album_page/E112D0E6-D2EA-43E8-A086-B8C6765ED4DC%2FL0%2F040/0/99
	var urlBase = 'http://192.168.232.71:8080';
	dateAfter = dateAfter || moment().subtract(1,'days');
	dateBefore = dateBefore || moment().add(1,'days');
	//minLengthSeconds = minLengthSeconds || 10;
	var files;
	
	return new Promise (function(resolve,reject){
		rp({url:url})
		.then(function(res){
			
			var html  = res.body;
			console.log("Got HTML: ", html.substring(1,300));
			var re = /<br ?\/> *(\d+\/\d+\/\d+ \d+:\d+) *<br\/> *<a href="[^"]+" rel="[^"]+">Preview<\/a> *<br\/> *<a href="([^"]+\/([^"\/]+))" target="_blank">Download<\/a>/g;
			var result, i = 0, files =[];
			
			while ((result = re.exec(html)) !== null) {
				files.push({
					'url': result[2],
					'date': moment(result[1],'MM/DD/YYYY hh:mm'),
					'filename': result[3],
					'index' : i,
					'filenameNoExtension' : result[3].replace(/^(.*)\..*?$/i,'$1')
				});
			}			
			
			files = files.filter(function(f,i){		
				return f.date.isSameOrBefore(dateBefore,'day') && f.date.isSameOrAfter(dateAfter,'day');
			});
			/*files = files.filter(function(f,i){
				var length = moment.duration('0:' + f.vl.trim()); 			
				return length.asSeconds() > minLengthSeconds;
			});*/
			files = files.map(function(f,index){

				var convfilename = formattedDate + ( args[index + 3] ? '_' + args[index + 3] : '') + '_' + f.filenameNoExtension; 
				//make object to return with various paths specified
				return {
					cameraFileURL: urlBase + f.url
					,downloadFilename: DOWNLOADDIR + f.filename
					, destFilePath:  DOWNLOADDIR + convfilename + ".mp4"
					, destWPfile:convfilename + ".mp4"
				};
			});

			//console.log(files);
			resolve(files);	
		})
		.catch(function(err){
			reject(err);
		})
		;
	});
}  
function getSourceFilesIphone(url,dateAfter, dateBefore, minLengthSeconds){
	url = url || 'http://192.168.99.3/photos/E112D0E6-D2EA-43E8-A086-B8C6765ED4DC';     
	dateAfter = dateAfter || moment().subtract(1,'days');
	dateBefore = dateBefore || moment().add(1,'days');
	minLengthSeconds = minLengthSeconds || 10;
	var files;
	
	return new Promise (function(resolve,reject){
		rp({url:url})
		.then(function(res){
			// [  {"i":0,"vl":" 0:20 ","c":"2016-02-08","v":1},
			//    {"i":1,"vl":" 2:57 ","c":"2016-02-08","v":1}  ]
			//console.log(res.body);
			files = JSON.parse(res.body);

			files = files.filter(function(f,i){
				var vidDate = moment(f.c,'YYYY-MM-DD');
				//var sameDate = vidDate.isSame(downloadDate,'day');			
				return vidDate.isSameOrBefore(dateBefore,'day') && vidDate.isSameOrAfter(dateAfter,'day');
			});
			files = files.filter(function(f,i){
				var length = moment.duration('0:' + f.vl.trim()); 			
				return length.asSeconds() > minLengthSeconds;
			});
			files = files.map(function(f,index){
				//keep the filename only
				var filename = f.c + '_' + f.i.toString();
				var convfilename = formattedDate +  ( args[index + 3] ? '_' + args[index + 3] : '') + '_' + f.i.toString(); 
				//make object to return with various paths specified
				return {
					cameraFileURL: 'http://192.168.99.3/video/' + f.i.toString()
					,downloadFilename: DOWNLOADDIR + filename + '.MOV'
					, destFilePath:  DOWNLOADDIR + convfilename  + ".mp4"
					, destWPfile:convfilename + ".mp4"
				};
			});

			
			//console.log(files);
			resolve(files);	
		})
		.catch(function(err){
			reject(err);
		})
		;
	});
}  
 
function getSourceFiles(){
	return Promise.resolve([
		{cameraFileURL: "http://itsupport/test/test.mp4", downloadFilename: "C:/temp/tango/GOPR0249x.MP4", destFilePath: "C:/temp/tango/GOPR0249convx.mp4", destWPfile:"GOPR0249convxd.mp4"}
		//,{cameraFileURL: "http://itsupport/test/test.mp4", downloadFilename: "C:/temp/tango/GOPR0251.MP4", destFilePath: "C:/temp/tango/GOPR0251conv.mp4", destWPfile:"GOPR0251conv.mp4"}
	]);
}  

