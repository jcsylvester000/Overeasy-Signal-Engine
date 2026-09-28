___TERMS_OF_SERVICE___

By creating or modifying this file you agree to Google Tag Manager's Community
Template Gallery Developer Terms of Service available at
https://developers.google.com/tag-manager/gallery-tos (or such other URL as
Google may provide), as modified from time to time.


___INFO___

{
  "type": "TAG",
  "id": "cvt_temp_public_id",
  "version": 1,
  "securityGroups": [],
  "displayName": "Signal Engine Tag",
  "categories": [
    "ATTRIBUTION",
    "LEAD_GENERATION",
    "CONVERSIONS"
  ],
  "brand": {
    "id": "brand_dummy",
    "displayName": "Signal Engine"
  },
  "description": "Loads the Signal Engine website tag. Captures ad click IDs and UTMs as first/last touch, auto-binds lead forms and sends lead signals to your Signal Engine workspace.",
  "containerContexts": [
    "WEB"
  ]
}


___TEMPLATE_PARAMETERS___

[
  {
    "type": "TEXT",
    "name": "tagHost",
    "displayName": "Tag host",
    "simpleValueType": true,
    "valueHint": "t.agency.com",
    "help": "Host name that serves ose.js, without https:// or a path (for example t.agency.com). Provided in your Signal Engine workspace.",
    "valueValidators": [
      {
        "type": "NON_EMPTY"
      },
      {
        "type": "REGEX",
        "args": [
          "^[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?(\\.[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?)+(:[0-9]{1,5})?$"
        ],
        "errorMessage": "Enter a host name only, for example t.agency.com (no https:// and no path)."
      }
    ]
  },
  {
    "type": "TEXT",
    "name": "siteKey",
    "displayName": "Site key",
    "simpleValueType": true,
    "valueHint": "site_abc123",
    "help": "The site key for this website, shown in your Signal Engine workspace. Format: site_ followed by 6-32 lowercase letters or digits.",
    "valueValidators": [
      {
        "type": "NON_EMPTY"
      },
      {
        "type": "REGEX",
        "args": [
          "^site_[a-z0-9]{6,32}$"
        ],
        "errorMessage": "Site key must look like site_ followed by 6-32 lowercase letters or digits."
      }
    ]
  },
  {
    "type": "CHECKBOX",
    "name": "mapConsent",
    "checkboxText": "Pass Google Consent Mode state (ad_user_data, ad_personalization) to the tag",
    "simpleValueType": true,
    "defaultValue": false,
    "help": "When enabled, the template reads the current GTM consent state for ad_user_data and ad_personalization and forwards it to the tag via ose.consent(). The tag also reads consent commands from the dataLayer on its own; enable this if your CMP sets consent through GTM consent APIs."
  }
]


___SANDBOXED_JS_FOR_WEB_TEMPLATE___

const injectScript = require('injectScript');
const setInWindow = require('setInWindow');
const copyFromWindow = require('copyFromWindow');
const callInWindow = require('callInWindow');
const createQueue = require('createQueue');
const isConsentGranted = require('isConsentGranted');
const encodeUriComponent = require('encodeUriComponent');
const makeString = require('makeString');
const logToConsole = require('logToConsole');

// Normalise the host: tolerate a pasted scheme or trailing slash.
let host = makeString(data.tagHost || '').trim().toLowerCase();
if (host.indexOf('https://') === 0) host = host.substring(8);
if (host.indexOf('http://') === 0) host = host.substring(7);
if (host.indexOf('/') !== -1) host = host.substring(0, host.indexOf('/'));
const siteKey = makeString(data.siteKey || '').trim();

if (!host || !siteKey || siteKey.indexOf('site_') !== 0) {
  logToConsole('Signal Engine: missing or invalid tag host / site key.');
  data.gtmOnFailure();
  return;
}

// The tag reads data-site from its <script> element, which injectScript cannot set.
// Expose the site key as a global the tag reads as a fallback (see TAG_PATCH.md).
setInWindow('oseConfig', { site: siteKey }, true);

// Optional: forward the current GTM consent state to the tag.
if (data.mapConsent) {
  const c = {
    ad_user_data: isConsentGranted('ad_user_data') ? 'granted' : 'denied',
    ad_personalization: isConsentGranted('ad_personalization') ? 'granted' : 'denied'
  };
  const existing = copyFromWindow('ose');
  if (existing && existing.version) {
    // Tag already running: call the API directly.
    callInWindow('ose.consent', c);
  } else if (existing) {
    // A pre-load stub exists: append to its queue.
    createQueue('ose.q')(['consent', c]);
  } else {
    // Nothing yet: create the pre-load queue the tag drains on start-up.
    setInWindow('ose', { q: [['consent', c]] }, false);
  }
}

const url = 'https://' + host + '/ose.js?site=' + encodeUriComponent(siteKey);

injectScript(url, data.gtmOnSuccess, data.gtmOnFailure, url);


___WEB_PERMISSIONS___

[
  {
    "instance": {
      "key": {
        "publicId": "inject_script",
        "versionId": "1"
      },
      "param": [
        {
          "key": "urls",
          "value": {
            "type": 2,
            "listItem": [
              {
                "type": 1,
                "string": "https://*/ose.js"
              }
            ]
          }
        }
      ]
    },
    "clientAnnotations": {
      "isEditedByUser": true
    },
    "isRequired": true
  },
  {
    "instance": {
      "key": {
        "publicId": "access_globals",
        "versionId": "1"
      },
      "param": [
        {
          "key": "keys",
          "value": {
            "type": 2,
            "listItem": [
              {
                "type": 3,
                "mapKey": [
                  { "type": 1, "string": "key" },
                  { "type": 1, "string": "read" },
                  { "type": 1, "string": "write" },
                  { "type": 1, "string": "execute" }
                ],
                "mapValue": [
                  { "type": 1, "string": "oseConfig" },
                  { "type": 8, "boolean": false },
                  { "type": 8, "boolean": true },
                  { "type": 8, "boolean": false }
                ]
              },
              {
                "type": 3,
                "mapKey": [
                  { "type": 1, "string": "key" },
                  { "type": 1, "string": "read" },
                  { "type": 1, "string": "write" },
                  { "type": 1, "string": "execute" }
                ],
                "mapValue": [
                  { "type": 1, "string": "ose" },
                  { "type": 8, "boolean": true },
                  { "type": 8, "boolean": true },
                  { "type": 8, "boolean": false }
                ]
              },
              {
                "type": 3,
                "mapKey": [
                  { "type": 1, "string": "key" },
                  { "type": 1, "string": "read" },
                  { "type": 1, "string": "write" },
                  { "type": 1, "string": "execute" }
                ],
                "mapValue": [
                  { "type": 1, "string": "ose.q" },
                  { "type": 8, "boolean": true },
                  { "type": 8, "boolean": true },
                  { "type": 8, "boolean": false }
                ]
              },
              {
                "type": 3,
                "mapKey": [
                  { "type": 1, "string": "key" },
                  { "type": 1, "string": "read" },
                  { "type": 1, "string": "write" },
                  { "type": 1, "string": "execute" }
                ],
                "mapValue": [
                  { "type": 1, "string": "ose.consent" },
                  { "type": 8, "boolean": false },
                  { "type": 8, "boolean": false },
                  { "type": 8, "boolean": true }
                ]
              }
            ]
          }
        }
      ]
    },
    "clientAnnotations": {
      "isEditedByUser": true
    },
    "isRequired": true
  },
  {
    "instance": {
      "key": {
        "publicId": "access_consent",
        "versionId": "1"
      },
      "param": [
        {
          "key": "consentTypes",
          "value": {
            "type": 2,
            "listItem": [
              {
                "type": 3,
                "mapKey": [
                  { "type": 1, "string": "consentType" },
                  { "type": 1, "string": "read" },
                  { "type": 1, "string": "write" }
                ],
                "mapValue": [
                  { "type": 1, "string": "ad_user_data" },
                  { "type": 8, "boolean": true },
                  { "type": 8, "boolean": false }
                ]
              },
              {
                "type": 3,
                "mapKey": [
                  { "type": 1, "string": "consentType" },
                  { "type": 1, "string": "read" },
                  { "type": 1, "string": "write" }
                ],
                "mapValue": [
                  { "type": 1, "string": "ad_personalization" },
                  { "type": 8, "boolean": true },
                  { "type": 8, "boolean": false }
                ]
              }
            ]
          }
        }
      ]
    },
    "clientAnnotations": {
      "isEditedByUser": true
    },
    "isRequired": true
  },
  {
    "instance": {
      "key": {
        "publicId": "logging",
        "versionId": "1"
      },
      "param": [
        {
          "key": "environments",
          "value": {
            "type": 1,
            "string": "debug"
          }
        }
      ]
    },
    "clientAnnotations": {
      "isEditedByUser": true
    },
    "isRequired": true
  }
]


___TESTS___

scenarios:
- name: Injects the tag and sets oseConfig
  code: |-
    const mockData = {
      tagHost: 't.agency.com',
      siteKey: 'site_abc123',
      mapConsent: false
    };

    mock('injectScript', function(url, onSuccess, onFailure, cacheToken) {
      onSuccess();
    });

    runCode(mockData);

    assertApi('injectScript').wasCalled();
    assertApi('injectScript').wasCalledWith(
      'https://t.agency.com/ose.js?site=site_abc123',
      mockData.gtmOnSuccess,
      mockData.gtmOnFailure,
      'https://t.agency.com/ose.js?site=site_abc123'
    );
    assertApi('setInWindow').wasCalledWith('oseConfig', { site: 'site_abc123' }, true);
    assertApi('isConsentGranted').wasNotCalled();
    assertApi('gtmOnSuccess').wasCalled();
- name: Consent mapping queues ose.consent before load
  code: |-
    const mockData = {
      tagHost: 'https://t.agency.com/',
      siteKey: 'site_abc123',
      mapConsent: true
    };

    mock('copyFromWindow', function(key) {
      return undefined;
    });
    mock('isConsentGranted', function(type) {
      return type === 'ad_user_data';
    });
    mock('injectScript', function(url, onSuccess, onFailure, cacheToken) {
      onSuccess();
    });

    runCode(mockData);

    assertApi('isConsentGranted').wasCalled();
    assertApi('setInWindow').wasCalledWith('ose', {
      q: [['consent', { ad_user_data: 'granted', ad_personalization: 'denied' }]]
    }, false);
    assertApi('injectScript').wasCalled();
    assertApi('gtmOnSuccess').wasCalled();
setup: ''


___NOTES___

Signal Engine Tag - GTM Custom Template (web)

REQUIRED TAG SUPPORT: sandboxed injectScript cannot set the data-site attribute
on the injected <script>. This template therefore:
  1. sets window.oseConfig = { site: <siteKey> } via setInWindow, and
  2. injects https://<tagHost>/ose.js?site=<siteKey>.
The tag (ose.js) must read window.oseConfig.site (or the ?site= query
parameter) when data-site is absent, and must locate its own script via
querySelector("script[src*='/ose.js']") when document.currentScript is null.
See TAG_PATCH.md for the exact change. Until that patch ships, leads sent via
this template will carry an empty site key.

Fire on: Consent Initialization or All Pages (Page View). One tag per site key.
Forms are auto-bound by the tag; use data-ose-ignore / data-ose-form /
data-ose-field attributes on the site to control capture.
