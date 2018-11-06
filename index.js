'use strict';

const fs = require('fs');
const path = require('path');
const util = require('util');
const makeDir = require('make-dir');
const maybe = require('call-me-maybe');
var hljs = require('highlightjs/highlight.pack.js');
var hlpath = require.resolve('highlightjs/highlight.pack.js').replace('highlight.pack.js', '');
const emoji = require('markdown-it-emoji');
const attrs = require('markdown-it-attrs');
const yaml = require('js-yaml');
const ejs = require('ejs');
const uglify = require('uglify-js');
const cheerio = require('cheerio');
const sanitizeHtml = require('sanitize-html');
var md = require('markdown-it')({
    linkify: true, html: true,
    highlight: function (str, lang) {
        var slang = lang.split('--')[0]; // allows multiple language tabs for the same language
        if (slang && hljs.getLanguage(slang)) {
            try {
                return '<pre class="highlight tab tab-' + lang + '"><code>' +
                    hljs.highlight(slang, str, true).value +
                    '</code></pre>';
            } catch (__) { }
        }

        return '<pre class="highlight"><code>' + md.utils.escapeHtml(str) + '</code></pre>';
    }
}).use(require('markdown-it-lazy-headers'));
md.use(emoji);

let globalOptions = {};

const EJS_TEMPLATE = path.resolve(path.join(__dirname, '/source/layouts'));
let SOURCE_LOCATION = path.join(__dirname, '/source/');
let LOCAL_WEB_ROOT = path.resolve(path.join(__dirname, '/pub/'));

/**
 * Class used to easily provide a standard set of
 * child directories for each file location.
 *
 * @class WebDir
 */
class DirSet {
    constructor(root_path) {
        this.root = root_path;
        if (path.parse(this.root).dir !== '') {
            this.root = path.normalize(path.resolve(this.root));
            this._create_child_dirs();
        }
    }

    _create_child_dirs() {
        ['css', 'fonts', 'img', 'js'].map(child_dir => {
            let full_path = path.join(this.root, this[child_dir]);
            makeDir(full_path);
        });
    }

    /**
     * The CSS directory for this location
     *
     * @type {string}
     * @returns {string}
     * @memberof WebDir
     */
    get css() {
        return this.root + '/css';
    }

    /**
     * The fonts directory for this location
     *
     * @type {string}
     * @returns {string}
     * @memberof WebDir
     */
    get fonts() {
        return this.root + '/fonts';
    }

    /**
     * The image directory for this location
     *
     * @type {string}
     * @returns {string}
     * @memberof WebDir
     */
    get img() {
        return this.root + '/img';
    }

    /**
     * The Javascript directory for this location
     *
     * @type {string}
     * @returns {string}
     * @memberof WebDir
     */
    get js() {
        return this.root + '/js';
    }

}

/**
 * Copies source to destination path, and then returns destination
 * directory minus the directory of globalOptions.local.root, plus the
 * filename of source.
 *
 * @example: copyToDest('./src/someimage.jpg', '../../build/img/someimage.jpg') => 'build/img/someimage.jpg'
 *
 * @param {string} destination The path where you want the file located
 * @param {string} source
 * @returns {string}
 */
function copyToDest(destination_path, source) {
    let dest = path.join(path.normalize(path.resolve(destination_path)), path.parse(source).base);
    fs.writeFileSync(dest, safeReadFileSync(source, 'utf8'), 'utf8');
    let web_name = path.normalize(globalOptions.web.root + '/' + dest.slice(globalOptions.local.root.length)).replace(/\\/g, '/');
    return web_name;
}

/**
 * Writes source to destination, and then returns destination
 * directory minus the directory of globalOptions.local.root
 *
 * @example: copyToDest('./src/someimage.jpg', '../../build/img/someimage.jpg') => 'build/img/someimage.jpg'
 *
 * @param {string} destination
 * @param {string} data
 * @returns {string}
 */
function writeToDest(destination, data) {
    let dest = path.normalize(path.resolve(destination));
    fs.writeFileSync(dest, data, 'utf8');
    let web_name = path.normalize(globalOptions.web.root + '/' + dest.slice(globalOptions.local.root.length)).replace(/\\/g, '/');
    return web_name;
}

/**
 * Tries to find path_string. Returns an empty string if unsuccessful,
 * or the full path of the resolved location, if found.
 *
 * @param {string} path_string
 * @returns {string}
 */
function resolvePath(path_string) {
    let filepath = path.resolve(path_string);
    if (fs.existsSync(filepath)) {
        return filepath;
    }
    let lookup_paths = [];
    ['img', 'js', 'css', 'fonts'].map(child_path => {
        [globalOptions.src, globalOptions.internal_source].map(webdir => {
            lookup_paths.push(webdir[child_path]);
        });
    });
    lookup_paths.push(path.join(hlpath, '/styles/'));
    let found_path = lookup_paths.find(this_path => {
        return fs.existsSync(path.join(this_path, path_string));
    });
    if (found_path) {
        return path.normalize(path.join(found_path, path_string));
    } else {
        console.warn('Could not find ' + path_string + '!');
        return undefined;
    }
}

function safeReadFileSync(filename,encoding) {
    try {
        return fs.readFileSync(filename,encoding);
    }
    catch (ex) {
        console.error(`shins: included file ${filename} not found`);
        if (globalOptions.cli) process.exit(1);
    }
    return '';
}

function javascript_include_tag(include) {
    var jsPath = resolvePath(include + '.inc');
    if (jsPath) {
        var includeStr = safeReadFileSync(jsPath, 'utf8');
        includeStr = includeStr.replace(/\|PATH\|/g, globalOptions.web.js);
        if (globalOptions.minify) {
            var scripts = [];
            var includes = includeStr.split('\r').join().split('\n');
            for (var i in includes) {
                var inc = includes[i];
                var elements = inc.split('"');
                if (elements[1]) {
                    if (elements[1] == 'text/javascript') {
                        scripts.push(path.join(globalOptions.src.js, '/all_nosearch.js'));
                        break;
                    } else {
                        scripts.push(path.join(__dirname, elements[1]));
                    }
                }
            }
            var bundle = uglify.minify(scripts);
            if (globalOptions.inline) {
                includeStr = '<script>'+bundle.code+'</script>';
            }
            else {
                includeStr = '<script src="' + writeToDest(path.join(globalOptions.local.js, '/shins.js'), bundle.code) + '"></script>';
                includeStr = safeReadFileSync(path.join(options.src.js, include + '.bundle.inc'), 'utf8');
            }
        }
        return includeStr;
    } else {
        return '';
    }
}

function partial(include) {
    var includeStr = safeReadFileSync(path.join(globalOptions.src.root, '/includes/_' + include + '.md'), 'utf8');
    return postProcess(md.render(clean(includeStr)));
}

function replaceAll(target, find, replace) {
    return target.replace(new RegExp(find.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&'), 'g'), replace);
}

/**
 * Returns the first path in paths where filename is found,
 * or undefined, if none of the paths work.
 *
 * @param {string} filename
 * @param {string[]} paths
 * @returns {string|undefined}
 */
function tryPaths(filename, paths) {
    let return_path = paths.filter(this_path => {
        return fs.existsSync(path.join(this_path, filename));
    });
    if (return_path) {
        return path.normalize(path.join(return_path, filename));
    } else {
        return undefined;
    }
}

function stylesheet_link_tag(stylesheet, media) {
    let override = stylesheet;
    let stylesheets = [];

    if ((stylesheet !== 'print') && (stylesheet !== 'screen')) {
        override = 'theme';
    }
    let stylePath = resolvePath(stylesheet + '.css');
    if (stylePath) {
        stylesheets.push(stylePath);
    }
    if (globalOptions.customCss && (stylesheet === 'print' || stylesheet === 'screen')) {
        let sheetPath = resolvePath(override + '_overrides.css');
        if (sheetPath) {
            stylesheets.push(copyToDest(globalOptions.local.css, sheetPath));
        }
    }
    if (globalOptions.css && (stylesheet === 'print' || stylesheet === 'screen')) {
        let global_css = resolvePath(globalOptions.css);
        if (global_css) {
            stylesheets.push(path.resolve(globalOptions.css));
        }
    }
    if (globalOptions.inline) {
        stylesheets = stylesheets.map(sheetPath => {
            let styleContent = safeReadFileSync(sheetPath, "utf8");
            styleContent = replaceAll(styleContent, '../../source/', globalOptions.web.root + '/');
            return '<style media="' + media + '">' + styleContent + '</style>';
        });
    } else {
        stylesheets = stylesheets.map(sheetPath => {
            let stylesheet_path = copyToDest(globalOptions.local.css, sheetPath);
            return '<link rel="stylesheet" media="' + media + '" href="' + stylesheet_path + '">';
        });
    }
    return stylesheets.join('\n');
}

function language_array(language_tabs) {
    var result = [];
    for (var lang in language_tabs) {
        if (typeof language_tabs[lang] === 'object') {
            result.push(Object.keys(language_tabs[lang])[0]);
        } else {
            result.push(language_tabs[lang]);
        }
    }
    return JSON.stringify(result).split('"').join('&quot;');
}

function preProcess(content, options) {
    let lines = content.split('\r').join('').split('\n');
    for (let l=0;l<lines.length;l++) {
        let line = lines[l];
        let filename = '';
        if (line.startsWith('include::') && line.endsWith('[]')) { // asciidoc syntax
            filename = line.split(':')[2].replace('[]','');
        } else if (line.startsWith('!INCLUDE ')) { // markdown-pp syntax
            filename = line.replace('!INCLUDE ','');
        }
        if (filename) {
            // if (options.source) filename = path.resolve(path.dirname(options.source), filename);
            filename = path.resolve(options.src.root, filename);
            let s = safeReadFileSync(filename,'utf8');
            let include = s.split('\r').join('').split('\n');
            lines.splice(l,1,...include);
        } else {
            lines[l] = line;
        }
    }
    return lines.join('\n');
}

function cleanId(id) {
    return id.toLowerCase().replace(/\W/g, '-');
}

function postProcess(content) {
    // adds id a la GitHub autolinks to automatically-generated headers
    content = content.replace(/\<(h[123456])\>(.*)\<\/h[123456]\>/g, function (match, header, title) {
        return '<' + header + ' id="' + cleanId(title) + '">' + title + '</' + header + '>';
    });

    // clean up the other ids as well
    content = content.replace(/\<(h[123456]) id="(.*)"\>(.*)\<\/h[123456]\>/g, function (match, header, id, title) {
        return '<' + header + ' id="' + cleanId(id) + '">' + title + '</' + header + '>';
    });
    return content;
}

function clean(s) {
    if (!s) return '';
    if (globalOptions.unsafe) return s;
    let sanitizeOptions = {
        allowedTags: sanitizeHtml.defaults.allowedTags.concat([ 'h1', 'h2', 'img', 'aside', 'article', 'details',
            'summary', 'abbr', 'meta', 'link' ]),
        allowedAttributes: { a: [ 'href', 'id', 'name', 'target', 'class' ], img: [ 'src', 'alt', 'class' ] , aside: [ 'class' ],
            abbr: [ 'title', 'class' ], details: [ 'open', 'class' ], div: [ 'class' ], meta: [ 'name', 'content' ],
            link: [ 'rel', 'href', 'type', 'sizes' ],
            h1: [ 'id' ], h2: [ 'id' ], h3: [ 'id' ], h4: [ 'id' ], h5: [ 'id' ], h6: [ 'id' ]}
    };
    // replace things which look like tags which sanitizeHtml will eat
    s = s.split('\n>').join('\n$1$');
    s = s.split('>=').join('$2$');
    s = s.split('<=').join('$3$');
    let a = s.split('```');
    for (let i=0;i<a.length;i++) {
        if (!a[i].startsWith('xml')) {
            a[i] = sanitizeHtml(a[i],sanitizeOptions);
        }
    }
    s = a.join('```');
    // put back things which sanitizeHtml has mangled
    s = s.split('&quot;').join('"');
    s = s.split('&amp;').join('&');
    s = s.split('&gt;').join('>');
    s = s.split('&lt;').join('<');
    s = s.split('\n$1$').join('\n>');
    s = s.split('$2$').join('>=');
    s = s.split('$3$').join('<=');
    return s;
}

function render(inputStr, options, callback) {

    if (options.attr) md.use(attrs);
    if (options.hasOwnProperty('no-links') && options['no-links'] === true) md.disable('linkify')

    if (typeof callback === 'undefined') { // for pre-v1.4.0 compatibility
        callback = options;
        options = {};
    }
    if (options.inline == true) {
        options.minify = true;
    }

    options.internal_source = new DirSet(path.resolve(SOURCE_LOCATION));
    // Where we'll copy assets from
    options.src = new DirSet(path.normalize(path.resolve(options.source
        ? options.source
        : SOURCE_LOCATION
    )));

    // Where assets will be copied to
    options.local = new DirSet(path.normalize(path.resolve(options.webRoot
        ? options.webRoot
        : LOCAL_WEB_ROOT
    )));

    // Path for the root web directory
    options.web = new DirSet(path.parse(options.local.root).name);

    return maybe(callback, new Promise(function (resolve, reject) {
        globalOptions = options;

        inputStr = inputStr.split('\r\n').join('\n');
        var inputArr = ('\n' + inputStr).split('\n---\n');
        if (inputArr.length === 1) {
            inputArr = ('\n' + inputStr).split('\n--- \n');
        }
        var headerStr = inputArr[1];
        var header = yaml.safeLoad(headerStr);

        /* non-matching languages between Ruby Rouge and highlight.js at 2016/07/10 are
        ['ceylon','common_lisp','conf','cowscript','erb','factor','io','json-doc','liquid','literate_coffeescript','literate_haskell','llvm','make',
        'objective_c','plaintext','praat','properties','racket','sass','sed','shell','slim','sml','toml','tulip','viml'];*/
        var sh = hljs.getLanguage('bash');
        hljs.registerLanguage('shell', function (hljs) { return sh; });
        hljs.registerLanguage('sh', function (hljs) { return sh; });

        while (inputArr.length<3) inputArr.push('');

        var content = preProcess(inputArr[2],options);
        content = md.render(clean(content));
        content = postProcess(content);

        var locals = {};
        locals.current_page = {};
        locals.current_page.data = header;
        locals.page_content = content;
        locals.toc_data = function(content) {
            var $ = cheerio.load(content);
            var result = [];
            var h1,h2,h3,h4,h5;
            var headingLevel = header.headingLevel || 2;
            $(':header').each(function(e){
                var tag = $(this).get(0).tagName.toLowerCase();
                var entry = {};
                if (tag === 'h1') {
                    entry.id = $(this).attr('id');
                    entry.content = $(this).text();
                    entry.children = [];
                    h1 = entry;
                    result.push(entry);
                }
                if (tag === 'h2') {
                    let child = {};
                    child.id = $(this).attr('id');
                    child.content = $(this).text();
                    child.children = [];
                    h2 = child;
                    if (h1) h1.children.push(child);
                }
                if ((headingLevel >= 3) && (tag === 'h3')) {
                    let child = {};
                    child.id = $(this).attr('id');
                    child.content = $(this).text();
                    child.children = [];
                    h3 = child;
                    if (h2) h2.children.push(child);
                }
                if ((headingLevel >= 4) && (tag === 'h4')) {
                    let child = {};
                    child.id = $(this).attr('id');
                    child.content = $(this).text();
                    child.children = [];
                    h4 = child;
                    if (h3) h3.children.push(child);
                }
                if ((headingLevel >= 5) && (tag === 'h5')) {
                    let child = {};
                    child.id = $(this).attr('id');
                    child.content = $(this).text();
                    child.children = [];
                    h5 = child;
                    if (h4) h4.children.push(child);
                }
                if ((headingLevel >= 6) && (tag === 'h6')) {
                    let child = {};
                    child.id = $(this).attr('id');
                    child.content = $(this).text();
                    if (h5) h5.children.push(child);
                }
            });
            return result; //[{id:'test',content:'hello',children:[]}];
        };
        locals.partial = partial;
        locals.image_tag = function (image, altText, className) {
            let imageSource = resolvePath(image);
            if (imageSource) {
                if (globalOptions.inline) {
                    // var imgContent = safeReadFileSync(path.join(__dirname, imageSource));
                    var imgContent = safeReadFileSync(imageSource);
                    imageSource = "data:image/png;base64," + Buffer.from(imgContent).toString('base64');
                } else {
                    imageSource = copyToDest(globalOptions.local.img, imageSource);
                }
                return '<img src="' + imageSource + '" class="' + className + '" alt="' + altText + '">';
            } else {
                return '';
            }
        };
        locals.logo_image_tag = function () {
            if (!globalOptions.logo) return locals.image_tag('logo.png', 'Logo', 'logo');
            let imageSource = resolvePath(globalOptions.logo);
            if (imageSource) {
                if (globalOptions.inline) {
                    imageSource = "data:image/png;base64," + Buffer.from(safeReadFileSync(imageSource)).toString('base64');
                } else {
                    imageSource = copyToDest(globalOptions.local.img, imageSource);
                }
                imageSource = '<img src="' + imageSource + '" class="logo" alt="Logo">';
                if (globalOptions['logo-url']) {
                    imageSource = '<a href="' + md.utils.escapeHtml(globalOptions['logo-url']) + '">' + imageSource + '</a>';
                }
                return imageSource;
            } else {
                return '';
            }
        };
        locals.stylesheet_link_tag = stylesheet_link_tag;
        locals.javascript_include_tag = javascript_include_tag;
        locals.language_array = language_array;

        var ejsOptions = {};
        ejsOptions.debug = false;
        ejs.renderFile(path.join(EJS_TEMPLATE, '/layout.ejs'), locals, ejsOptions, function (err, str) {
            if (err) reject(err)
            else resolve(str);
        });
    }));
}

module.exports = {
    render: render,
    srcDir: function () { return __dirname; }
};
