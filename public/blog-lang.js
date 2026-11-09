// Blog language controls:
// - persist the chosen locale so lang-detect.js does not override it
// - power the compact combobox on blog pages (mobile-friendly)
(function () {
  var STORAGE_KEY = 'sonvudev_lang';

  function save(code) {
    if (!code) return;
    try { localStorage.setItem(STORAGE_KEY, code); } catch (_) { /* private mode */ }
  }

  function close(box) {
    if (!box) return;
    var dropdown = box.querySelector('.lang-dropdown');
    var trigger = box.querySelector('.lang-trigger');
    box.setAttribute('aria-expanded', 'false');
    if (trigger) trigger.setAttribute('aria-expanded', 'false');
    if (dropdown) dropdown.setAttribute('aria-hidden', 'true');
  }

  function open(box) {
    if (!box) return;
    document.querySelectorAll('.lang-combobox[data-blog-lang-nav]').forEach(function (other) {
      if (other !== box) close(other);
    });
    var dropdown = box.querySelector('.lang-dropdown');
    var trigger = box.querySelector('.lang-trigger');
    box.setAttribute('aria-expanded', 'true');
    if (trigger) trigger.setAttribute('aria-expanded', 'true');
    if (dropdown) dropdown.setAttribute('aria-hidden', 'false');
  }

  try {
    // Persist on any blog language link (combobox option or legacy link).
    document.addEventListener('click', function (e) {
      var link = e.target && e.target.closest ? e.target.closest('[data-blog-lang]') : null;
      if (link && link.tagName === 'A') save(link.getAttribute('data-blog-lang'));
    }, true);

    document.querySelectorAll('.lang-combobox[data-blog-lang-nav]').forEach(function (box) {
      var trigger = box.querySelector('.lang-trigger');
      if (trigger) {
        trigger.addEventListener('click', function (e) {
          e.preventDefault();
          e.stopPropagation();
          var expanded = box.getAttribute('aria-expanded') === 'true';
          if (expanded) close(box); else open(box);
        });
      }
      box.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') { close(box); if (trigger) trigger.focus(); }
      });
    });

    document.addEventListener('click', function (e) {
      if (e.target && e.target.closest && e.target.closest('.lang-combobox[data-blog-lang-nav]')) return;
      document.querySelectorAll('.lang-combobox[data-blog-lang-nav]').forEach(close);
    });
  } catch (_) {
    // ignore
  }
})();
