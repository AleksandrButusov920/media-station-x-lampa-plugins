(function () {
    'use strict';

    // ─────────────────────────────────────────────
    //  MSX Search Plugin for Lampa
    //  Version: 2.0.0
    //  Supports: Lampa 1.x / 2.x
    // ─────────────────────────────────────────────

    var PLUGIN_NAME   = 'MSX Search';
    var PLUGIN_ID     = 'msx_search';
    var PLUGIN_ICON   = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/></svg>';

    // ── Public MSX / TMDB-compatible API endpoints ──────────────────────────
    var ENDPOINTS = {
        tmdb: {
            name: 'TMDB',
            base: 'https://api.themoviedb.org/3',
            key: '4ef0d7355d9ffb5151e987764708ce96',  // public demo key
            img: 'https://image.tmdb.org/t/p/w500',
            lang: 'ru-RU'
        }
    };

    // ────────────────────────────────────────────────────────────────────────
    //  Utility helpers
    // ────────────────────────────────────────────────────────────────────────
    function http(url, callback, errback) {
        var xhr = new XMLHttpRequest();
        xhr.open('GET', url, true);
        xhr.timeout = 10000;
        xhr.onreadystatechange = function () {
            if (xhr.readyState === 4) {
                if (xhr.status === 200) {
                    try { callback(JSON.parse(xhr.responseText)); }
                    catch (e) { if (errback) errback(e); }
                } else {
                    if (errback) errback(new Error('HTTP ' + xhr.status));
                }
            }
        };
        xhr.ontimeout = function () { if (errback) errback(new Error('timeout')); };
        xhr.send();
    }

    function esc(str) {
        return encodeURIComponent(str || '');
    }

    function img(path) {
        if (!path) return './img/img_broken.svg';
        return ENDPOINTS.tmdb.img + path;
    }

    function year(date) {
        return date ? date.substring(0, 4) : '';
    }

    // ────────────────────────────────────────────────────────────────────────
    //  API layer
    // ────────────────────────────────────────────────────────────────────────
    var API = {
        /**
         * Multi-search: movies + TV series in one shot
         */
        search: function (query, page, callback, errback) {
            var ep = ENDPOINTS.tmdb;
            var url = ep.base + '/search/multi'
                + '?api_key=' + ep.key
                + '&language=' + ep.lang
                + '&query=' + esc(query)
                + '&page=' + (page || 1)
                + '&include_adult=false';
            http(url, function (data) {
                callback({
                    query: query,
                    page: data.page,
                    total_pages: data.total_pages,
                    total_results: data.total_results,
                    results: (data.results || []).filter(function (r) {
                        return r.media_type === 'movie' || r.media_type === 'tv';
                    })
                });
            }, errback);
        },

        /** Trending for the "empty query" state */
        trending: function (callback, errback) {
            var ep = ENDPOINTS.tmdb;
            var url = ep.base + '/trending/all/week'
                + '?api_key=' + ep.key
                + '&language=' + ep.lang;
            http(url, function (data) {
                callback(data.results || []);
            }, errback);
        },

        /** Full card details */
        details: function (id, type, callback, errback) {
            var ep = ENDPOINTS.tmdb;
            var url = ep.base + '/' + type + '/' + id
                + '?api_key=' + ep.key
                + '&language=' + ep.lang
                + '&append_to_response=credits,videos,external_ids';
            http(url, callback, errback);
        }
    };

    // ────────────────────────────────────────────────────────────────────────
    //  Lampa Card builder
    // ────────────────────────────────────────────────────────────────────────
    function buildCard(item) {
        var isMovie  = item.media_type === 'movie';
        var title    = isMovie ? (item.title || '') : (item.name || '');
        var original = isMovie ? (item.original_title || '') : (item.original_name || '');
        var date     = isMovie ? item.release_date : item.first_air_date;
        var vote     = item.vote_average ? item.vote_average.toFixed(1) : '';

        return {
            id:              item.id,
            type:            item.media_type,
            title:           title,
            original_title:  original,
            overview:        item.overview || '',
            poster_path:     item.poster_path || null,
            backdrop_path:   item.backdrop_path || null,
            release_date:    date || '',
            vote_average:    vote,
            genres:          item.genre_ids || [],
            // Lampa-native fields
            name:            title,
            poster:          img(item.poster_path),
            background_image:img(item.backdrop_path),
            release_year:    year(date),
            rating:          vote
        };
    }

    // ────────────────────────────────────────────────────────────────────────
    //  Keyboard / virtual keyboard helper
    // ────────────────────────────────────────────────────────────────────────
    function showKeyboard(current, callback) {
        // Use Lampa's built-in keyboard if available
        if (Lampa && Lampa.Keyboard) {
            Lampa.Keyboard.show({
                title: PLUGIN_NAME,
                value: current || '',
                cancel: function () {},
                submit: function (val) { callback(val.trim()); }
            });
        } else {
            // Fallback: native browser prompt (for testing outside Lampa)
            var val = prompt('Поиск', current || '');
            if (val !== null) callback(val.trim());
        }
    }

    // ────────────────────────────────────────────────────────────────────────
    //  Component
    // ────────────────────────────────────────────────────────────────────────
    function Component() {
        var self    = this;
        var network = new Lampa.Reguest();  // Lampa network wrapper (handles abort)
        var scroll  = new Lampa.Scroll({ mask: true, over: true });
        var items   = [];
        var cards   = [];

        // State
        var query      = '';
        var page       = 1;
        var totalPages = 1;
        var loading    = false;

        // ── DOM structure ───────────────────────────────────────────────────
        var $wrap  = Lampa.Template.js('msx_wrap');
        var $head  = $wrap.find('.msx--head');
        var $hint  = $wrap.find('.msx--hint');
        var $grid  = $wrap.find('.msx--grid');
        var $loader= $wrap.find('.msx--loader');
        var $empty = $wrap.find('.msx--empty');
        var $pages = $wrap.find('.msx--pages');

        // ── Public Lampa lifecycle ──────────────────────────────────────────
        this.create = function () {
            scroll.append($wrap);
            self.activity.loader(true);
            loadTrending();
            return scroll.render();
        };

        this.start = function () {
            Lampa.Controller.add('content', {
                toggle: function () {
                    Lampa.Controller.collectionSet($grid);
                    Lampa.Controller.collectionFocus(false, $grid);
                },
                left:   function () { Lampa.Controller.toggle('menu'); },
                up:     function () { Lampa.Controller.toggle('menu'); },
                down:   function () {},
                back:   function () { Lampa.Activity.backward(); }
            });
            Lampa.Controller.toggle('content');
        };

        this.pause  = function () {};
        this.stop   = function () {};

        this.destroy = function () {
            network.clear();
            cards.forEach(function (c) { if (c.destroy) c.destroy(); });
            scroll.destroy();
        };

        // ── Search button in header ─────────────────────────────────────────
        $head.find('.msx--btn-search').on('click', function () {
            showKeyboard(query, function (val) {
                if (val) doSearch(val);
            });
        });

        // ── Infinite scroll / "load more" ───────────────────────────────────
        scroll.onEnd(function () {
            if (!loading && page < totalPages) {
                page++;
                loadMore();
            }
        });

        // ── Internal methods ─────────────────────────────────────────────────
        function loadTrending() {
            setLoading(true);
            API.trending(function (results) {
                self.activity.loader(false);
                setLoading(false);
                renderResults(results, true);
                $hint.text('Популярное на этой неделе');
                $pages.text('');
            }, onError);
        }

        function doSearch(q, p) {
            query = q;
            page  = p || 1;
            if (page === 1) {
                clearGrid();
            }
            setLoading(true);
            $hint.text('Поиск: «' + query + '»…');

            API.search(query, page, function (data) {
                setLoading(false);
                totalPages = data.total_pages;
                $hint.text('«' + query + '» — найдено: ' + data.total_results);
                $pages.text('Стр. ' + data.page + ' / ' + totalPages);

                if (data.results.length === 0 && page === 1) {
                    $empty.show();
                } else {
                    $empty.hide();
                    renderResults(data.results, page === 1);
                }
            }, onError);
        }

        function loadMore() {
            doSearch(query, page);
        }

        function renderResults(results, reset) {
            if (reset) clearGrid();
            results.forEach(function (item) {
                var card = buildLampaCard(buildCard(item));
                $grid.append(card);
                cards.push(card);
                items.push(item);
            });
            scroll.resize();
        }

        function buildLampaCard(data) {
            var card = new Lampa.Card(data);
            card.create();
            card.onPlay = function () { openCard(data); };
            card.onInfo = function () { openCard(data); };
            return card.render();
        }

        function openCard(data) {
            API.details(data.id, data.type, function (full) {
                // Merge and open via Lampa's native movie/serial activity
                var merged = Object.assign({}, data, full);
                Lampa.Activity.push({
                    url:       '',
                    title:     data.title || data.name,
                    component: data.type === 'movie' ? 'full' : 'full',
                    id:        data.id,
                    source:    'tmdb',
                    card:      merged
                });
            }, onError);
        }

        function clearGrid() {
            cards.forEach(function (c) { if (c.remove) c.remove(); });
            cards = [];
            $grid.empty();
        }

        function setLoading(state) {
            loading = state;
            $loader.toggleClass('visible', state);
        }

        function onError(err) {
            setLoading(false);
            self.activity.loader(false);
            Lampa.Noty.show('Ошибка запроса: ' + (err && err.message ? err.message : err));
        }
    }

    // ────────────────────────────────────────────────────────────────────────
    //  HTML template
    // ────────────────────────────────────────────────────────────────────────
    var TEMPLATE_HTML = '\
<div class="msx-plugin">\
  <div class="msx--head">\
    <span class="msx--logo">' + PLUGIN_ICON + ' MSX Search</span>\
    <button class="msx--btn-search selector" data-action="search">\
      <svg viewBox="0 0 24 24"><path d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/></svg>\
      Поиск\
    </button>\
  </div>\
  <div class="msx--hint"></div>\
  <div class="msx--loader"><div class="msx--spinner"></div></div>\
  <div class="msx--empty" style="display:none">Ничего не найдено</div>\
  <div class="msx--grid"></div>\
  <div class="msx--pages"></div>\
</div>';

    // ────────────────────────────────────────────────────────────────────────
    //  CSS styles (injected once)
    // ────────────────────────────────────────────────────────────────────────
    var STYLES = '\
.msx-plugin { padding: 1.6em 2em; }\
.msx--head { display:flex; align-items:center; gap:1em; margin-bottom:1em; }\
.msx--logo { display:flex; align-items:center; gap:.4em; font-size:1.4em; font-weight:700; color:#fff; }\
.msx--logo svg { width:1.1em; height:1.1em; fill:#e8a838; flex-shrink:0; }\
.msx--btn-search { display:flex; align-items:center; gap:.4em; padding:.4em 1.1em;\
  background:rgba(255,255,255,.08); border:1px solid rgba(255,255,255,.15);\
  border-radius:2em; cursor:pointer; color:#fff; font-size:.95em;\
  transition: background .2s, border-color .2s; }\
.msx--btn-search:hover, .msx--btn-search:focus { background:rgba(232,168,56,.25); border-color:#e8a838; outline:none; }\
.msx--btn-search svg { width:1em; height:1em; fill:currentColor; }\
.msx--hint { font-size:.9em; color:rgba(255,255,255,.55); margin-bottom:1em; min-height:1.2em; }\
.msx--pages { font-size:.85em; color:rgba(255,255,255,.35); text-align:right; margin-top:.5em; }\
.msx--empty { text-align:center; color:rgba(255,255,255,.4); padding:4em 0; font-size:1.1em; }\
.msx--grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(160px,1fr)); gap:1.1em; }\
.msx--loader { display:none; justify-content:center; padding:1.5em 0; }\
.msx--loader.visible { display:flex; }\
.msx--spinner { width:2em; height:2em; border:3px solid rgba(255,255,255,.15);\
  border-top-color:#e8a838; border-radius:50%; animation:msx-spin .8s linear infinite; }\
@keyframes msx-spin { to { transform:rotate(360deg); } }\
';

    // ────────────────────────────────────────────────────────────────────────
    //  Registration
    // ────────────────────────────────────────────────────────────────────────
    function register() {
        // Guard: make sure Lampa is ready
        if (typeof Lampa === 'undefined') {
            console.warn('[MSX] Lampa not found, retrying in 500ms…');
            setTimeout(register, 500);
            return;
        }

        // Inject CSS
        if (!document.getElementById('msx-styles')) {
            var style = document.createElement('style');
            style.id  = 'msx-styles';
            style.textContent = STYLES;
            document.head.appendChild(style);
        }

        // Register template
        Lampa.Template.add('msx_wrap', TEMPLATE_HTML);

        // Register component
        Lampa.Component.add(PLUGIN_ID, Component);

        // Add to main menu
        Lampa.Menu.add({
            title: PLUGIN_NAME,
            icon:  PLUGIN_ICON,
            action: function () {
                Lampa.Activity.push({
                    url:       '',
                    title:     PLUGIN_NAME,
                    component: PLUGIN_ID,
                    page:      1
                });
            }
        });

        console.log('[MSX] Plugin registered ✓');
    }

    // ── Entry point ──────────────────────────────────────────────────────────
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', register);
    } else {
        register();
    }

})();
