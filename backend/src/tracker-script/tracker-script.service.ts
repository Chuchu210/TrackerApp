import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class TrackerScriptService {
  constructor(private readonly config: ConfigService) {}

  getScript(): string {
    const baseUrl = this.config.get<string>('TRACKER_BASE_URL') || 'http://localhost:3001';

    return `(function (w, d, g, k) {
  var TK_BASE_FALLBACK = "${baseUrl}";
  var TK_BASE = TK_BASE_FALLBACK;
  var secure = w.location.protocol === "https:" ? "secure; " : "";

  function resolveTrackerBase(tag) {
    try {
      if (tag && tag.src) return new URL(tag.src, w.location.href).origin;
    } catch (e) {}
    return TK_BASE_FALLBACK;
  }

  function getCid() {
    var m = d.cookie.match(/(^| )tk-cid=([^;]+)/);
    if (m) return m[2];
    var exp = g.getItem("tk-cid-expires");
    if (exp && +exp > Date.now()) return g.getItem("tk-cid");
    return null;
  }

  function saveCid(cid) {
    var h = new Date();
    h.setTime(h.getTime() + 86400000);
    d.cookie = "tk-cid=" + cid + "; " + secure + "samesite=Strict; expires=" + h.toUTCString() + "; path=/";
    g.setItem("tk-cid", cid);
    g.setItem("tk-cid-expires", h.getTime());
  }

  function getVid() {
    var m = d.cookie.match(/(^| )tk-vid=([^;]+)/);
    if (m) return decodeURIComponent(m[2]);
    return g.getItem("tk-vid");
  }

  function saveVid(vid) {
    if (!vid) return;
    var h = new Date();
    h.setTime(h.getTime() + 31536000000);
    d.cookie = "tk-vid=" + encodeURIComponent(vid) + "; " + secure + "samesite=Lax; expires=" + h.toUTCString() + "; path=/";
    g.setItem("tk-vid", vid);
  }

  function readCookie(name) {
    var m = d.cookie.match(new RegExp("(^| )" + name + "=([^;]+)"));
    return m ? decodeURIComponent(m[2]) : null;
  }

  function urlParams() {
    var p = {};
    new URLSearchParams(w.location.search).forEach(function (v, key) {
      p[key.toLowerCase()] = v;
    });
    // OpenAI Ads browser reference: the Conversions API needs it replayed with
    // the conversion, so forward it with the visit if the pixel set it.
    if (!p.obref) {
      var ob = readCookie("__obref");
      if (ob) p.obref = ob;
    }
    return p;
  }

  function currentScript() {
    // Must survive defer/async. document.currentScript points at the exact
    // executing tag for classic + defer scripts (so it stays correct even with
    // two tracker snippets on one page); it is null only for async, where we
    // fall back to a src match, then to the legacy "last script" heuristic.
    return (
      d.currentScript ||
      d.querySelector('script[src*="/t/tracker.js"]') ||
      (function () {
        var scripts = d.getElementsByTagName("script");
        return scripts[scripts.length - 1];
      })()
    );
  }

  function isNoViewContent(tag) {
    if (!tag) return false;
    var v = tag.getAttribute("data-no-viewcontent");
    return v === "" || v === "true" || v === "1";
  }

  function registerDirectVisit(campaignId, tag) {
    if (!campaignId || getCid()) return;
    var params = urlParams();
    var vid = getVid();
    var noViewContent = isNoViewContent(tag);
    fetch(TK_BASE + "/t/visit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        campaign: campaignId,
        params: params,
        visitorId: vid || undefined,
        noViewContent: noViewContent || undefined,
      }),
      keepalive: true,
    })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (data && data.visitorId) saveVid(data.visitorId);
        if (data && data.clickId) {
          saveCid(data.clickId);
          if (!noViewContent) maybeAutoViewContent(tag);
        }
      })
      .catch(function () {});
  }

  w.tkCallback = w.tkCallback || function () {};
  w.tkCallback.state = w.tkCallback.state || { callbackQueue: [] };

  function isMediagoSource(params) {
    var src = (params.utm_source || params.utmsource || "").toLowerCase().trim();
    return src === "mediago" || src === "mg" || src.indexOf("mediago") >= 0;
  }

  function trackConversion(eventType, meta) {
    meta = meta || {};
    var cid = getCid();
    if (!cid) return;
    var body = {
      clickId: cid,
      eventType: eventType || meta.eventType || meta.et || meta.event || "lead",
      metadata: meta,
    };
    if (meta.payout != null) body.revenue = Number(meta.payout);
    else if (meta.revenue != null) body.revenue = Number(meta.revenue);
    if (meta.transactionId || meta.txid) body.transactionId = meta.transactionId || meta.txid;
    fetch(TK_BASE + "/conversions/track", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      keepalive: true,
    }).catch(function () {});
  }

  function maybeAutoViewContent(tag) {
    if (isNoViewContent(tag)) return;
    var cid = getCid();
    if (!cid) return;
    var params = urlParams();
    if (!isMediagoSource(params)) return;
    var dedupeKey = "tk-vc-sent-" + cid;
    if (g.getItem(dedupeKey)) return;
    g.setItem(dedupeKey, "1");
    trackConversion("viewcontent", { source: "auto_pageview", utm_source: params.utm_source || "mediago" });
  }

  w.tkCallback.registerConversion = function (meta) {
    meta = meta || {};
    w.tkCallback.state.callbackQueue.push(meta);
    var et = meta.eventType || meta.et || meta.event || "lead";
    trackConversion(et, meta);
  };

  w.tkCallback.trackViewContent = function (meta) {
    trackConversion("viewcontent", meta || {});
  };

  w.tkCallback.trackClickButton = function (meta) {
    trackConversion("click_button", meta || {});
  };

  w.tkCallback.trackCallClick = function (meta) {
    trackConversion("call_click", meta || {});
  };

  w.tkCallback.trackCallConnected = function (meta) {
    trackConversion("call_connected", meta || {});
  };

  w.tkCallback.trackPurchase = function (meta) {
    trackConversion("purchase", meta || {});
  };

  w.dtpCallback = w.tkCallback;

  (function init() {
    var tag = currentScript();
    TK_BASE = resolveTrackerBase(tag);

    var params = new URLSearchParams(w.location.search);
    var urlCid = params.get("tk-cid") || params.get("tk_cid");
    if (urlCid) {
      saveCid(urlCid);
    }

    var campaign = tag && tag.getAttribute("data-campaign");
    var mode = (tag && tag.getAttribute("data-mode")) || "direct";

    if (mode === "direct" && campaign && !getCid()) {
      registerDirectVisit(campaign, tag);
    } else if (getCid()) {
      maybeAutoViewContent(tag);
    }
  })();
})(window, document, localStorage, encodeURIComponent);`;
  }

  getLpScriptSnippet(
    campaignRef: string,
    mode: 'redirect' | 'direct',
    trackerBase?: string,
    options?: { noViewContent?: boolean },
  ): string {
    const baseUrl =
      trackerBase || this.config.get<string>('TRACKER_BASE_URL') || 'http://localhost:3001';
    let tag = `<script defer src="${baseUrl}/t/tracker.js" data-campaign="${campaignRef}" data-mode="${mode}"`;
    if (options?.noViewContent) {
      tag += ' data-no-viewcontent="true"';
    }
    return `${tag}></script>`;
  }
}
