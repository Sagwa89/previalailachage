(() => {
  "use strict";

  // Substitua pelo identificador da propriedade GA4 da cliente, no formato G-XXXXXXXXXX.
  const measurementId = "G-XXXXXXXXXX";
  const isConfigured = /^G-[A-Z0-9]+$/i.test(measurementId) && !measurementId.includes("XXXXXXXXXX");

  window.trackSiteEvent = (eventName, parameters = {}) => {
    if (typeof window.gtag !== "function") return;
    window.gtag("event", eventName, parameters);
  };

  if (!isConfigured) return;

  window.dataLayer = window.dataLayer || [];
  window.gtag = function gtag() {
    window.dataLayer.push(arguments);
  };
  window.gtag("js", new Date());
  window.gtag("config", measurementId);

  const script = document.createElement("script");
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(measurementId)}`;
  document.head.append(script);
})();
