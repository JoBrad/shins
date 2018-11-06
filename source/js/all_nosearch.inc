<script src="|PATH|/lib/_jquery.js"></script>
<script src="|PATH|/lib/_energize.js"></script>
<script src="|PATH|/app/_lang.js"></script>
<script src="|PATH|/app/_toc.js"></script>
<script type="text/javascript">
$(function() {
  loadToc($('#toc'), '.toc-link', '.toc-list-h2, .toc-list-h3, .toc-list-h4, .toc-list-h5, .toc-list-h6', 10);
  setupLanguages($('body').data('languages'));
  $('.content').imagesLoaded( function() {
    recacheHeights();
    refreshToc();
  });
});

window.onpopstate = function() {
  activateLanguage(getLanguageFromQueryString());
};
</script>
