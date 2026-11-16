/**
 * Copyright 2018 Google Inc. All Rights Reserved.
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *     http://www.apache.org/licenses/LICENSE-2.0
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

// If the loader is already loaded, just stop.
if (!self.define) {
  let registry = {};

  // Used for `eval` and `importScripts` where we can't get script URL by other means.
  // In both cases, it's safe to use a global var because those functions are synchronous.
  let nextDefineUri;

  const singleRequire = (uri, parentUri) => {
    uri = new URL(uri + ".js", parentUri).href;
    return registry[uri] || (
      
        new Promise(resolve => {
          if ("document" in self) {
            const script = document.createElement("script");
            script.src = uri;
            script.onload = resolve;
            document.head.appendChild(script);
          } else {
            nextDefineUri = uri;
            importScripts(uri);
            resolve();
          }
        })
      
      .then(() => {
        let promise = registry[uri];
        if (!promise) {
          throw new Error(`Module ${uri} didn’t register its module`);
        }
        return promise;
      })
    );
  };

  self.define = (depsNames, factory) => {
    const uri = nextDefineUri || ("document" in self ? document.currentScript.src : "") || location.href;
    if (registry[uri]) {
      // Module is already loading or loaded.
      return;
    }
    let exports = {};
    const require = depUri => singleRequire(depUri, uri);
    const specialDeps = {
      module: { uri },
      exports,
      require
    };
    registry[uri] = Promise.all(depsNames.map(
      depName => specialDeps[depName] || require(depName)
    )).then(deps => {
      factory(...deps);
      return exports;
    });
  };
}
define(['./workbox-afac4cd2'], (function (workbox) { 'use strict';

  self.skipWaiting();
  workbox.clientsClaim();
  /**
   * The precacheAndRoute() method efficiently caches and responds to
   * requests for URLs in the manifest.
   * See https://goo.gl/S9QRab
   */
  workbox.precacheAndRoute([{
    "url": "registerSW.js",
    "revision": "1872c500de691dce40960bb85481de07"
  }, {
    "url": "pwa-maskable-512x512.png",
    "revision": "d7977eb0adfc26704c54fa9b168acc60"
  }, {
    "url": "pwa-512x512.png",
    "revision": "b15349f6e489332396003f1961a9a3d3"
  }, {
    "url": "pwa-192x192.png",
    "revision": "1144eab5c5c99d0b2a494592c8d53ba7"
  }, {
    "url": "index.html",
    "revision": "a1eaaf503c68a4ffafb46e002c563557"
  }, {
    "url": "icon.svg",
    "revision": "4f1e2faf951f641373b13e57a33161ba"
  }, {
    "url": "icon.png",
    "revision": "b8e873ae4bf2b0e797bac61dc0cce1c2"
  }, {
    "url": "icon-512.png",
    "revision": "b15349f6e489332396003f1961a9a3d3"
  }, {
    "url": "apple-touch-icon.png",
    "revision": "7da48b7ecc4c4beff9399d3781c97024"
  }, {
    "url": "assets/index-DtPOwQqr.js",
    "revision": null
  }, {
    "url": "assets/index-1tsEJKRz.css",
    "revision": null
  }, {
    "url": "assets/aistudio/aplikasi_baca_pribadi_pembaca_epub_terjemahan_ai_08dd14e6.html",
    "revision": null
  }, {
    "url": "apple-touch-icon.png",
    "revision": "7da48b7ecc4c4beff9399d3781c97024"
  }, {
    "url": "icon-512.png",
    "revision": "b15349f6e489332396003f1961a9a3d3"
  }, {
    "url": "icon.svg",
    "revision": "4f1e2faf951f641373b13e57a33161ba"
  }, {
    "url": "pwa-192x192.png",
    "revision": "1144eab5c5c99d0b2a494592c8d53ba7"
  }, {
    "url": "pwa-512x512.png",
    "revision": "b15349f6e489332396003f1961a9a3d3"
  }, {
    "url": "pwa-maskable-512x512.png",
    "revision": "d7977eb0adfc26704c54fa9b168acc60"
  }, {
    "url": "manifest.webmanifest",
    "revision": "0fa9c099d04555e2cc1f259960a23978"
  }], {});
  workbox.cleanupOutdatedCaches();
  workbox.registerRoute(new workbox.NavigationRoute(workbox.createHandlerBoundToURL("index.html")));
  workbox.registerRoute(/^https:\/\/fonts\.googleapis\.com\/.*/i, new workbox.CacheFirst({
    "cacheName": "google-fonts-cache",
    plugins: [new workbox.ExpirationPlugin({
      maxEntries: 10,
      maxAgeSeconds: 31536000
    }), new workbox.CacheableResponsePlugin({
      statuses: [0, 200]
    })]
  }), 'GET');
  workbox.registerRoute(/^https:\/\/fonts\.gstatic\.com\/.*/i, new workbox.CacheFirst({
    "cacheName": "gstatic-fonts-cache",
    plugins: [new workbox.ExpirationPlugin({
      maxEntries: 10,
      maxAgeSeconds: 31536000
    }), new workbox.CacheableResponsePlugin({
      statuses: [0, 200]
    })]
  }), 'GET');

}));
