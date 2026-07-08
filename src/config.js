(() => {
  const hostname = window.location.hostname;
  const isLocalPreview = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '';

  window.JIJIN_CONFIG = {
    // Cloudflare Pages 线上环境走同源 /api/*，由 functions/api/[[path]].js 代理到真实后端。
    // 本地调试不再使用 Mock；如需连接本地或远端后端，请设置 localStorage.JIJIN_API_BASE。
    API_BASE: isLocalPreview ? '' : window.location.origin,
    MOCK_ENABLED: false,
  };
})();
