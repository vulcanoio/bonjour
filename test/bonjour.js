'use strict'

var os = require('os')
var dgram = require('dgram')
var tape = require('tape')
var afterAll = require('after-all')
var Service = require('../lib/service')
var Bonjour = require('../')

var getAddresses = function () {
  var addresses = []
  var itrs = os.networkInterfaces()
  for (var i in itrs) {
    var addrs = itrs[i]
    for (var j in addrs) {
      if (addrs[j].internal === false) {
        addresses.push(addrs[j].address)
      }
    }
  }
  return addresses
}

var port = function (cb) {
  var s = dgram.createSocket('udp4')
  s.bind(0, function () {
    var port = s.address().port
    s.on('close', function () {
      cb(port)
    })
    s.close()
  })
}

var test = function (name, fn) {
  tape(name, function (t) {
    port(function (p) {
      fn(Bonjour({ ip: '127.0.0.1', port: p, multicast: false }), t)
    })
  })
}

test('bonjour.publish', function (bonjour, t) {
  var service = bonjour.publish({ name: 'foo', type: 'bar', port: 3000 })
  t.ok(service instanceof Service)
  t.equal(service.published, false)
  service.on('up', function () {
    t.equal(service.published, true)
    bonjour.destroy()
    t.end()
  })
})

test('bonjour.unpublishAll', function (bonjour, t) {
  t.test('published services', function (t) {
    var service = bonjour.publish({ name: 'foo', type: 'bar', port: 3000 })
    service.on('up', function () {
      bonjour.unpublishAll(function (err) {
        t.error(err)
        t.equal(service.published, false)
        bonjour.destroy()
        t.end()
      })
    })
  })

  t.test('no published services', function (t) {
    bonjour.unpublishAll(function (err) {
      t.error(err)
      t.end()
    })
  })
})

test('bonjour.find', function (bonjour, t) {
  var next = afterAll(function () {
    var browser = bonjour.find({ type: 'test' })
    var ups = 0

    browser.on('up', function (s) {
      if (s.name === 'Sub Foo') return

      if (s.name === 'Foo Bar') {
        t.equal(s.name, 'Foo Bar')
        t.equal(s.fqdn, 'Foo Bar._test._tcp.local')
        t.deepEqual(s.txt, {})
        t.deepEqual(s.rawTxt, new Buffer('00', 'hex'))
      } else {
        t.equal(s.name, 'Baz')
        t.equal(s.fqdn, 'Baz._test._tcp.local')
        t.deepEqual(s.txt, { foo: 'bar' })
        t.deepEqual(s.rawTxt, new Buffer('07666f6f3d626172', 'hex'))
      }
      t.equal(s.host, os.hostname())
      t.equal(s.port, 3000)
      t.equal(s.type, 'test')
      t.equal(s.protocol, 'tcp')
      t.equal(s.referer.address, '127.0.0.1')
      t.equal(s.referer.family, 'IPv4')
      t.ok(Number.isFinite(s.referer.port))
      t.ok(Number.isFinite(s.referer.size))
      t.deepEqual(s.subtypes, [])
      t.deepEqual(s.addresses.sort(), getAddresses().sort())

      if (++ups === 2) {
        // use timeout in an attempt to make sure the invalid record doesn't
        // bubble up
        setTimeout(function () {
          bonjour.destroy()
          t.end()
        }, 50)
      }
    })
  })

  bonjour.publish({ name: 'Foo Bar', type: 'test', port: 3000 }).on('up', next())
  bonjour.publish({ name: 'Invalid', type: 'test2', port: 3000 }).on('up', next())
  bonjour.publish({ name: 'Sub Foo', type: 'test', subtypes: [ 'stOne', 'stTwo' ], port: 3000 }).on('up', next())
  bonjour.publish({ name: 'Baz', type: 'test', port: 3000, txt: { foo: 'bar' } }).on('up', next())
})

test('bonjour.find - all services', function (bonjour, t) {
  var next = afterAll(function () {
    var browserServices = bonjour.find({})
    var ups = 0
    var found = []

    browserServices.on('up', function (s) {
      // Ensures that bonjour responds to the '_services._dns-sd._udp.local'
      // request.
      found.push(s.name)

      if (++ups === 4) {
        found.sort()
        t.equal(found[0], 'Baz')
        t.equal(found[1], 'Foo Bar')
        t.equal(found[2], 'Invalid')
        t.equal(found[3], 'Sub Foo')
        bonjour.destroy()
        t.end()
      }
    })
  })

  bonjour.publish({ name: 'Foo Bar', type: 'test', port: 3000 }).on('up', next())
  bonjour.publish({ name: 'Invalid', type: 'test2', port: 3000 }).on('up', next())
  bonjour.publish({ name: 'Sub Foo', type: 'test', subtypes: [ 'stOne', 'stTwo' ], port: 3000 }).on('up', next())
  bonjour.publish({ name: 'Baz', type: 'test', port: 3000, txt: { foo: 'bar' } }).on('up', next())
})

test('bonjour.find - subtypes', function (bonjour, t) {
  var next = afterAll(function () {
    var browserSubtypes = bonjour.find({ type: 'test', subtypes: [ 'stOne', 'stTwo' ] })
    var subUp = 0

    browserSubtypes.on('up', function (s) {
      t.equal(s.name, 'Sub Foo')
      t.equal(s.fqdn, 'Sub Foo._test._tcp.local')
      t.deepEqual(s.txt, {})
      t.deepEqual(s.rawTxt, new Buffer('00', 'hex'))
      t.equal(s.host, os.hostname())
      t.equal(s.port, 3000)
      t.equal(s.type, 'test')
      t.equal(s.protocol, 'tcp')
      t.equal(s.referer.address, '127.0.0.1')
      t.equal(s.referer.family, 'IPv4')
      t.ok(Number.isFinite(s.referer.port))
      t.ok(Number.isFinite(s.referer.size))
      if (++subUp === 2) {
        // Subtypes may be out of order depending on order records were
        // received in.
        var testCount = 0
        s.subtypes.forEach(function (subtype) {
          if ((subtype === 'stTwo') || (subtype === 'stOne')) {
            testCount += 1
          }
        })
        t.equal(testCount, 2)
        bonjour.destroy()
        t.end()
      }
    })
  })

  bonjour.publish({ name: 'Foo Bar', type: 'test', port: 3000 }).on('up', next())
  bonjour.publish({ name: 'Invalid', type: 'test2', port: 3000 }).on('up', next())
  bonjour.publish({ name: 'Sub Foo', type: 'test', subtypes: [ 'stOne', 'stTwo' ], port: 3000 }).on('up', next())
  bonjour.publish({ name: 'Baz', type: 'test', port: 3000, txt: { foo: 'bar' } }).on('up', next())
})

test('bonjour.find - binary txt', function (bonjour, t) {
  var next = afterAll(function () {
    var browser = bonjour.find({ type: 'test', txt: { binary: true } })

    browser.on('up', function (s) {
      t.equal(s.name, 'Foo')
      t.deepEqual(s.txt, { bar: new Buffer('buz') })
      t.deepEqual(s.rawTxt, new Buffer('076261723d62757a', 'hex'))
      bonjour.destroy()
      t.end()
    })
  })

  bonjour.publish({ name: 'Foo', type: 'test', port: 3000, txt: { bar: new Buffer('buz') } }).on('up', next())
})

test('bonjour.find - down event', function (bonjour, t) {
  var service = bonjour.publish({ name: 'Foo Bar', type: 'test', port: 3000 })

  service.on('up', function () {
    var browser = bonjour.find({ type: 'test' })

    browser.on('up', function (s) {
      t.equal(s.name, 'Foo Bar')
      service.stop()
    })

    browser.on('down', function (s) {
      t.equal(s.name, 'Foo Bar')
      bonjour.destroy()
      t.end()
    })
  })
})

test('bonjour.findOne - callback', function (bonjour, t) {
  var next = afterAll(function () {
    bonjour.findOne({ type: 'test' }, function (s) {
      t.equal(s.name, 'Callback')
      bonjour.destroy()
      t.end()
    })
  })

  bonjour.publish({ name: 'Invalid', type: 'test2', port: 3000 }).on('up', next())
  bonjour.publish({ name: 'Callback', type: 'test', port: 3000 }).on('up', next())
})

test('bonjour.findOne - emitter', function (bonjour, t) {
  var next = afterAll(function () {
    var browser = bonjour.findOne({ type: 'test' })
    browser.on('up', function (s) {
      t.equal(s.name, 'Emitter')
      bonjour.destroy()
      t.end()
    })
  })

  bonjour.publish({ name: 'Emitter', type: 'test', port: 3000 }).on('up', next())
  bonjour.publish({ name: 'Invalid', type: 'test2', port: 3000 }).on('up', next())
})
