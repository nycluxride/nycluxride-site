(function () {
  var ADS_TAG_ID = "AW-18190711813";

  window.NLR_ADS_ID = ADS_TAG_ID;

  window.nlrDataLayer = window.nlrDataLayer || [];
  if (typeof window.nlrGtag !== "function") {
    window.nlrGtag = function () { window.nlrDataLayer.push(arguments); };
  }

  if (location.hostname !== "www.nycluxride.com") return;
  try {
    var page = new URL(location.href), bypass = 0;
    ["x-vercel-protection-bypass", "x-vercel-set-bypass-cookie"].forEach(function (key) {
      if (page.searchParams.has(key)) { page.searchParams.delete(key); bypass = 1; }
    });
    if (bypass) history.replaceState(history.state, "", page.pathname + page.search + page.hash);
  } catch (e) {}

  try {
    window.nlrGtag("js", new Date());
    window.nlrGtag("config", ADS_TAG_ID);

    window.__nlrForwardNumber = null;
    window.nlrGtag("config", ADS_TAG_ID + "/s5hCCPecteMcEIX4gOJD", {
      "phone_conversion_number": "+16467750556",
      "phone_conversion_callback": function (formatted_number, mobile_number) {
        window.__nlrForwardNumber = {
          formatted: formatted_number,
          mobile: mobile_number
        };
        if (typeof window.__nlrApplyForwardNumber === "function") {
          window.__nlrApplyForwardNumber();
        }
      }
    });

    var s = document.createElement("script");
    s.async = true;
    s.src = "https://www.googletagmanager.com/gtag/js?id=" + encodeURIComponent(ADS_TAG_ID) + "&l=nlrDataLayer";
    (document.head || document.documentElement).appendChild(s);
  } catch (e) {}
})();
