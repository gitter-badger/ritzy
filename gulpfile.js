/* global argv */

// Include Gulp and other build automation tools and utilities
// See: https://github.com/gulpjs/gulp/blob/master/docs/API.md
var gulp = require('gulp')
var $ = require('gulp-load-plugins')()
var del = require('del')
var path = require('path')
var runSequence = require('run-sequence')
var webpack = require('webpack')
var options = require('minimist')(process.argv.slice(2), {
  alias: {
    debug: 'D',
    verbose: 'V'
  },
  boolean: ['release', 'debug', 'verbose'],
  default: {
    debug: false,
    verbose: false
  }
})

$.util.log('[args]', '   debug = ' + options.debug)
$.util.log('[args]', ' verbose = ' + options.verbose)

// https://github.com/ai/autoprefixer
options.autoprefixer = [
  'last 2 version'
]

var paths = {
  build: 'build',
  dist: 'dist',
  lib: 'lib',
  src: [
    'src/**/*.js',
    '!src/server.js',
    '!src/**/__tests__/**/*.js',
    '!src/**/__mocks__/**/*.js',
    '!src/assets/*',
    '!src/templates/*',
    '!src/tests/*'
  ]
}
var src = {
  assets: [
    'src/assets/**',
    'src/templates*/**'
  ],
  server: [
    paths.build + '/client.js',
    paths.build + '/server.js',
    paths.build + '/templates/**/*'
  ]
}
var watch = false
var browserSync

var DEVELOPMENT_HEADER = [
  '/**',
  ' * Ritzy v<%= version %>',
  ' */'
].join('\n') + '\n'

var PRODUCTION_HEADER = [
  '/**',
  ' * Ritzy v<%= version %>',
  ' *',
  ' * Copyright 2015, VIVO Systems, Inc.',
  ' * All rights reserved.',
  ' *',
  ' * This source code is licensed under the Apache v2 license found in the',
  ' * LICENSE.txt file in the root directory of this source tree.',
  ' *',
  ' */'
].join('\n') + '\n'

var webpackOpts = function(output, debug, configs) {
  var autoprefixer = 'last 2 version'
  return require('./webpack.config.js')(output, debug, options.verbose, configs, autoprefixer)
}
var webpackCompletion = function(err, stats) {
  if(err) {
    throw new $.util.PluginError('webpack', err, {showStack: true})
  }
  var jsonStats = stats.toJson()
  var statsOptions = { colors: true/*, modulesSort: 'size'*/ }
  if(jsonStats.errors.length > 0) {
    if(watch) {
      $.util.log('[webpack]', stats.toString(statsOptions))
    } else {
      throw new $.util.PluginError('webpack', stats.toString(statsOptions))
    }
  }
  if(jsonStats.warnings.length > 0 || options.verbose) {
    $.util.log('[webpack]', stats.toString(statsOptions))
  }
  if(jsonStats.errors.length === 0 && jsonStats.warnings.length === 0) {
    $.util.log('[webpack]', 'No errors or warnings.')
  }
}

// Check the version of node currently being used
gulp.task('node-version', function(cb) { // eslint-disable-line no-unused-vars
  return require('child_process').fork(null, {execArgv: ['--version']})
})

// The default task
gulp.task('default', ['serve'])

// Clean output directory
gulp.task('clean', del.bind(
  null, ['.tmp', paths.build, paths.lib + '/*', paths.dist + '/*', '!' + paths.dist + '/.git'], {dot: true}
))

// Static files
gulp.task('assets', function() {
  return gulp.src(src.assets)
    .pipe($.changed(paths.build))
    .pipe(gulp.dest(paths.build))
    .pipe($.size({title: 'assets'}))
})

// Bundle
gulp.task('bundle', function(cb) {
  var started = false
  function bundle(err, stats) {
    webpackCompletion(err, stats)
    if (!started) {
      started = true
      return cb()
    }
  }

  var bundler = webpack(webpackOpts(paths.build, true, { server: true, client: true, lib: false }))
  if (watch) {
    bundler.watch(200, bundle)
  } else {
    bundler.run(bundle)
  }
})

// Build and run the app from source code
gulp.task('run:prep', ['clean'], function(cb) {
  runSequence(['assets', 'bundle'], cb)
})

// Run and start watching for modifications
gulp.task('run:watch', function(cb) {
  watch = true
  runSequence('run:prep', function(err) {
    gulp.watch(src.assets, ['assets'])
    cb(err)
  })
})

// Launch a Node.js/Express server
gulp.task('serve', ['run:watch'], function(cb) {
  var started = false
  var cp = require('child_process')
  var assign = require('react/lib/Object.assign')
  var nodeArgs = {}
  if(options.debug) {
    $.util.log('[node]', 'Node.js debug port set to 5858.')
    nodeArgs.execArgv = ['--debug-brk=5858']
  }

  var server = (function startup() {
    var child = cp.fork(paths.build + '/server.js', nodeArgs, {
      env: assign({NODE_ENV: 'development'}, process.env)
    })
    child.once('message', function(message) {
      if (message.match(/^online$/)) {
        if (browserSync) {
          browserSync.reload()
        }
        if (!started) {
          started = true
          gulp.watch(src.server, function() {
            $.util.log('Restarting development server.')
            server.kill('SIGTERM')
            server = startup()
          })
          cb()
        }
      }
    })
    return child
  })()
})

// Launch BrowserSync development server
gulp.task('sync', ['serve'], function(cb) {
  browserSync = require('browser-sync')

  browserSync({
    notify: false,
    // Run as an https by setting 'https: true'
    // Note: this uses an unsigned certificate which on first access
    //       will present a certificate warning in the browser.
    https: false,
    // Informs browser-sync to proxy our Express app which would run
    // at the following location
    proxy: 'localhost:5000'
  }, cb)

  process.on('exit', function() {
    browserSync.exit()
  })

  gulp.watch([paths.build + '/**/*.*'].concat(
    src.server.map(function(file) { return '!' + file })
  ), function(file) {
    browserSync.reload(path.relative(__dirname, file.path))
  })
})

gulp.task('modules', ['clean'], function() {
  return gulp
    .src(paths.src, {base: 'src'})
    //.pipe($.flatten())
    .pipe(gulp.dest(paths.lib))
})

var dist = function(cb, header, debug, lib) {
  function webpackCb(err, stats) {
    webpackCompletion(err, stats)
    gulp.src(paths.build + '/' + lib)
      .pipe($.header(header, {
        version: process.env.npm_package_version
      }))
      .pipe(gulp.dest(paths.dist))
    return cb()
  }

  webpack(webpackOpts(paths.build, debug, { server: false, client: false, lib: true, libName: lib }), webpackCb)
}

gulp.task('dist', ['modules'], function(cb) {
  return dist(cb, DEVELOPMENT_HEADER, true, 'ritzy.js')
})

gulp.task('dist:min', ['modules'], function(cb) {
  return dist(cb, PRODUCTION_HEADER, false, 'ritzy.min.js')
})

// Deploy to GitHub Pages
gulp.task('deploy', function() {
  // Remove temp folder
  if (argv.clean) {
    var os = require('os')
    var repoPath = path.join(os.tmpdir(), 'tmpRepo')
    $.util.log('Delete ' + $.util.colors.magenta(repoPath))
    del.sync(repoPath, {force: true})
  }

  return gulp.src(paths.build + '/**/*')
    .pipe($.if('**/robots.txt', !argv.production ?
      $.replace('Disallow:', 'Disallow: /') : $.util.noop()))
    .pipe($.ghPages({
      remoteUrl: 'https://github.com/{name}/{name}.github.io.git',
      branch: 'master'
    }))
})

// Run Google's PageSpeed Insights (https://developers.google.com/speed/pagespeed/insights/)
gulp.task('pagespeed', function(cb) {
  var pagespeed = require('psi')
  // TODO Update the below URL to the public URL of our site
  pagespeed.output('example.com', {
    strategy: 'mobile'
    // By default we use the PageSpeed Insights free (no API key) tier.
    // Use a Google Developer API key if you have one: http://goo.gl/RkN0vE
    // key: 'YOUR_API_KEY'
  }, cb)
})
