'use strict';
const fs = require('fs');
const path = require('path');
const util = require('util');
const makeDir = require('make-dir');
const maybe = require('call-me-maybe');
var hljs = require('highlightjs/highlight.pack.js');
var HLJS_PATH = require.resolve('highlightjs/highlight.pack.js').replace('highlight.pack.js', '');
const emoji = require('markdown-it-emoji');
const attrs = require('markdown-it-attrs');
const yaml = require('js-yaml');
const ejs = require('ejs');
const splitlines = require('split-lines');
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

// Exposes user-provided options to the whole script
let GLOBAL_OPTIONS = {};

// The location of the EJS template
let EJS_TEMPLATE_FILE = path.resolve(path.join(__dirname, '/source/layouts/layout.ejs'));
// Where assets files are located
let SOURCE_LOCATION = path.join(__dirname, '/source/');
// Where assets will be saved
let LOCAL_WEB_ROOT = path.resolve(path.join(__dirname, '/pub/'));

/**
 * Class used to easily provide a standard set of
 * child directories for each file location.
 *
 * @class FolderGroup
 */
class FolderGroup {
    constructor(root_path) {
        this.root = root_path;
        this.is_relative = true;
        if (path.parse(this.root).dir !== '') {
            this.is_relative = false;
            this.root = path.normalize(path.resolve(this.root));
            this._create_child_dirs();
        }
    }

    _create_child_dirs() {
        let root_dir = this.root;
        ['css', 'fonts', 'img', 'js'].map(child_dir => {
            let full_path = path.join(root_dir, child_dir);
            makeDir.sync(full_path);
        });
    }

    _dir_without_root() {
        return this.root.split('/').slice(1).join('/');
    }

    /**
     * If this is a relative path, returns the root without the
     * base folder, otherwise returns the entire root.
     *
     * @readonly
     * @memberof FolderGroup
     */
    get dirname() {
        if (this.is_relative) {
            return this._dir_without_root();
        } else {
            return this.root;
        }
    }

    /**
     * Returns the appropriate folder for the provided filename.
     * Will be the root folder, if the folder cannot be resolved.
     *
     * @param {string} filename
     * @memberof FolderGroup
     * @returns {string}
     */
    folderForFile(filename) {
        let file_extension = path.extname(filename).slice(1);
        if (this[file_extension]) {
            return this[file_extension];
        } else {
            return this.root;
        }
    }

    /**
     * The CSS directory for this location
     *
     * @type {string}
     * @returns {string}
     * @memberof WebDir
     */
    get css() {
        return this.dirname + '/css';
        // } else {
        //     return this.root + '/css';
        // }
    }

    /**
     * The fonts directory for this location
     *
     * @type {string}
     * @returns {string}
     * @memberof WebDir
     */
    get fonts() {
        return this.dirname + '/fonts';
        // if (this.is_relative) {
        //     return this._dir_without_root() + '/fonts';
        // } else {
        //     return this.root + '/fonts';
        // }
    }

    /**
     * The image directory for this location
     *
     * @type {string}
     * @returns {string}
     * @memberof WebDir
     */
    get img() {
        return this.dirname + '/img';
        // if (this.is_relative) {
        //     return this._dir_without_root() + '/img';
        // } else {
        //     return this.root + '/img';
        // }
    }

    /**
     * The Javascript directory for this location
     *
     * @type {string}
     * @returns {string}
     * @memberof WebDir
     */
    get js() {
        return this.dirname + '/js';
        // if (this.is_relative) {
        //     return this._dir_without_root() + '/js';
        // } else {
        //     return this.root + '/js';
        // }
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
    makeDir.sync(path.parse(dest).dir);
    fs.copyFileSync(source, dest);
    // fs.writeFileSync(dest, safeReadFileSync(source, 'utf8'), 'utf8');
    let web_name = path.normalize(dest.slice(GLOBAL_OPTIONS.local.root.length)).replace(/\\/g, '/');
    return web_name;
}

/**
 * Writes data to destination, and then returns destination
 * directory minus the directory of globalOptions.local.root
 *
 * @example: writeToDest('./src/somedoc.txt', 'My file contents') => 'build/src/somedoc.txt'
 *
 * @param {string} destination
 * @param {string} data
 * @returns {string}
 */
function writeToDest(destination, data) {
    let dest = path.normalize(path.resolve(destination));
    fs.writeFileSync(dest, data, 'utf8');
    let web_name = path.normalize(dest.slice(GLOBAL_OPTIONS.local.root.length)).replace(/\\/g, '/');
    return web_name;
}

/**
 * Joins the provided paths. Tries to avoid joining 2 paths with the same normalized value
 * @param {string} path_string
 * @returns {string}
 */
function joinPath() {
    let last_path_string;
    let return_path = '';
    for (let path_string of arguments) {
        if (typeof last_path_string === 'undefined' || (typeof last_path_string !== 'undefined' && last_path_string !== path.normalize(path_string))) {
            return_path = path.join(return_path, path_string);
            last_path_string = path.normalize(path_string)
        }
    }
    return path.normalize(return_path);
}

/**
 * Returns HTML for the provided tagName, with any attributes and the tag value populated.
 * If the tag is a self-closing tag, it will be self-closed, provided no
 * tagValue is provided.
 *
 * @param {string} tagName
 * @param {object} attributeObj
 * @param {string} tagValue
 * @returns {string}
 */
function makeHTMLTag(tagName, attributeObj, tagValue) {
    const self_closing_tags = ['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
                                'link', 'meta', 'param', 'source', 'track', 'wbr', 'command',
                                'keygen', 'menuitem'];
    let tag_name = tagName.toLowerCase().trim();
    let attribute_obj, tag_value;
    if (typeof attributeObj === 'object') {
        attribute_obj = attributeObj;
    }
    if (typeof tagValue !== 'undefined') {
        tag_value = tagValue;
    } else if (typeof tagValue === 'undefined' && typeof attributeObj !== 'object') {
        tag_value = attributeObj;
        attribute_obj = {};
    }

    let tag_src = '<' + tag_name + ' ';
    tag_src += Object.keys(attribute_obj).map(function (attr) {
        let attr_value = attribute_obj[attr];
        let quote_char = '';
        if (typeof attr_value === 'string') {
            if (attr_value.trim() === '' && ['id', 'class'].indexOf(attr) > -1) {
                attr_value = undefined;
            } else {
                attr_value = attr_value.replace(/"/g, '\'');
                quote_char = '"';
            }
        } else if (typeof attr_value === 'object') {
            attr_value = Object.keys(attr_value).map(attr => {
                let val = attr_value[attr];
                if (typeof val === 'string') val = '\'' + val + '\'';
                return [attr, val].join('=');
            }).join(';');
            quote_char = '"';
        }
        return attr + '=' + quote_char + attr_value + quote_char;
    }).join(' ');

    if (typeof tag_value === 'undefined') {
        tag_src += ' ' + (self_closing_tags.indexOf(tag_name) > -1 ? '/' : '') + '>';
    } else {
        tag_src += '>' + tag_value + '</' + tag_name + '>';
    }
    return tag_src;
}

/**
 * Tries to find path_string. Returns an empty string if unsuccessful,
 * or the full path of the resolved location, if found.
 *
 * @param {string} path_string
 * @param {string} initial_path An optional path to check before checking other paths
 * @param {object} opts A substitute for GLOBAL_OPTIONS which should contain .src and .internal_source
 * @returns {string}
 */
function resolvePath(path_string, initial_path, opts) {
    let int_opts = opts || GLOBAL_OPTIONS;
    let lookup_paths = [];

    if (typeof initial_path === 'string' && initial_path.trim() !== '') {
        lookup_paths.push(path.join(initial_path, path_string));
    }
    if (path.resolve(path_string) === path.normalize(path_string)) {
        lookup_paths.push(path_string);
    } else {
        lookup_paths.push(path.resolve(path_string));
    }

    if (int_opts) {
        if (int_opts.src) {
            lookup_paths.push(path.join(int_opts.src.folderForFile(path_string), path_string));
            ['root', 'img', 'js', 'css', 'fonts'].map(child_path => {
                [int_opts.src].map(webdir => {
                    lookup_paths.push(path.join(webdir[child_path], path_string));
                });
            });
        }
        if (int_opts.internal_source) {
            lookup_paths.push(path.join(int_opts.internal_source.folderForFile(path_string), path_string));
            ['root', 'img', 'js', 'css', 'fonts'].map(child_path => {
                [int_opts.internal_source].map(webdir => {
                    lookup_paths.push(path.join(webdir[child_path], path_string));
                });
            });
        }
    }

    lookup_paths.push(path.join(HLJS_PATH, '/styles/', path_string));
    let found_path = lookup_paths.find(this_path => {
        return fs.existsSync(this_path);
    });
    if (found_path) {
        return found_path;
    } else {
        console.warn('Could not find ' + path_string + '!');
        return undefined;
    }
}

/**
 * Reads from filename with encoding. If unable to read, and GLOBAL_OPTIONS.cli is true,
 * then the script will exit with a code of 1. Otherwise an empty string is returned.
 *
 * @param {*} filename
 * @param {*} encoding
 * @returns
 */
function safeReadFileSync(filename, encoding) {
    try {
        return fs.readFileSync(filename,encoding);
    }
    catch (ex) {
        console.error(`shins: included file ${filename} not found`);
        if (GLOBAL_OPTIONS.cli) process.exit(1);
    }
    return '';
}

/**
 * Returns an array of src values for all script tags
 *
 * @param {*} str_content
 */
function getSrcLinks(str_content) {
    let found_paths = [];
    if (typeof str_content === 'string' && str_content.trim() !== '') {
        let matchPatt = /<script src=\"([^\"]+)\"/g;
        let found_value;
        while ( (found_value=matchPatt.exec(str_content)) !== null) {
            found_paths.push(found_value[1]);
        }
    }
    return found_paths;
}

/**
 * Reads a Javascript file and returns the appropriate content to include in the HTML file.
 *
 * @param {string} include The base name of the javascript file
 * @returns {string}
 */
function includeJSTag(include) {
    let includeStr = resolvePath(include + '.inc');
    if (includeStr) {
        let jsScript = safeReadFileSync(includeStr, 'utf8');
        getSrcLinks(jsScript).map(function(file_link) {
            let clean_file_link = file_link.replace(/\|PATH\|/g, '');
            let sub_dir = path.dirname(clean_file_link);
            let source_file = resolvePath(clean_file_link, path.dirname(includeStr));
            if (source_file) {
                let new_path = copyToDest(path.join(GLOBAL_OPTIONS.local.js, sub_dir), source_file);
                jsScript = jsScript.replace(file_link, new_path);
            } else {
                log.warn('Could not find the source for ' + file_link + '!');
            }
        });
        // jsScript = jsScript.replace(/\|PATH\|/g, GLOBAL_OPTIONS.web.js);
        if (GLOBAL_OPTIONS.minify) {
            let scripts = [];
            let includes = splitlines(jsScript); // .split('\r').join().split('\n');
            for (var i in includes) {
                var inc = includes[i];
                var elements = inc.split('"');
                if (elements[1]) {
                    if (elements[1] == 'text/javascript') {
                        scripts.push(path.join(GLOBAL_OPTIONS.src.js, '/all_nosearch.js'));
                        break;
                    } else {
                        scripts.push(path.join(__dirname, elements[1]));
                    }
                }
            }
            var bundle = uglify.minify(scripts);
            jsScript = bundle.code;
            includeStr = (GLOBAL_OPTIONS.inline)
                ? '<script>' + jsScript + '</script>'
                : '<script src="' + writeToDest(path.join(GLOBAL_OPTIONS.local.js, '/shins.js'), jsScript) + '"></script>'
            ;
        } else {
            includeStr = jsScript;
        }
        return includeStr;
    } else {
        return '';
    }
}

/**
 * Reads additional markdown files, and returns their rendered HTML
 *
 * @param {string} include
 * @returns {string}
 */
function partial(include) {
    let includeStr = safeReadFileSync(path.join(GLOBAL_OPTIONS.src.root, '/includes/_' + include + '.md'), 'utf8');
    return postProcess(md.render(clean(includeStr)));
}

/**
 * Replaces find with replace in target
 *
 * @param {string} target
 * @param {string} find
 * @param {string} replace
 * @returns {string}
 */
function replaceAll(target, find, replace) {
    return target.replace(new RegExp(find.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&'), 'g'), replace);
}

/**
 * Returns either the in-line CSS or the link tags for the CSS, depending on GLOBAL_OPTIONS
 *
 * @param {string} stylesheet The base name of the stylesheet to include, or 'theme'
 * @param {string} media The type of media this stylesheet is intended for
 * @returns {string}
 */
function includeStylesheetTag(stylesheet, media) {
    let override = stylesheet;
    let stylesheets = [];

    if ((stylesheet !== 'print') && (stylesheet !== 'screen')) {
        override = 'theme';
    }
    let stylePath = resolvePath(stylesheet + '.css');
    if (stylePath) {
        stylesheets.push(stylePath);
    }
    if (GLOBAL_OPTIONS.customCss && (stylesheet === 'print' || stylesheet === 'screen')) {
        let sheetPath = resolvePath(override + '_overrides.css');
        if (sheetPath) {
            stylesheets.push(sheetPath);
        }
    }
    if (GLOBAL_OPTIONS.css && (stylesheet === 'print' || stylesheet === 'screen')) {
        let global_css = resolvePath(GLOBAL_OPTIONS.css);
        if (global_css) {
            stylesheets.push(global_css);
        }
    }
    stylesheets = (GLOBAL_OPTIONS.inline)
        ? stylesheets.map(s_path => {
                let styleContent = safeReadFileSync(s_path, "utf8");
                styleContent = styleContent.replace(/\.\.\/\.\.\/source\//gi, GLOBAL_OPTIONS.web._dir_without_root);
                return makeHTMLTag('style', {media: media}, styleContent);
                // return '<style media="' + media + '">' + styleContent + '</style>';
            })
        : stylesheets.map(s_path => {
                let stylesheet_path = copyToDest(GLOBAL_OPTIONS.local.css, s_path);
                return makeHTMLTag('link', {rel: 'stylesheet', media: media, href: stylesheet_path});
                // return '<link rel="stylesheet" media="' + media + '" href="' + stylesheet_path + '">';
            })
    ;
    return stylesheets.join('\n');
}

/**
 * Returns an array of languages specified by the user
 * cast as a string
 *
 * @example: toLanguageArray([{"html":"HTML"}, {"shell": "Shell"}]) -> "[&quot;HTML&quot;,&quot;Shell&quot;]"
 * @param {string[]} language_tabs
 * @returns {string}
 */
function toLanguageArray(language_tabs) {
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

/**
 * Looks for include statements in the markdown, and replaces them with the indicated files
 *
 * @param {string} content
 * @param {object} options
 * @returns {string}
 */
function preProcessMarkdown(content, options) {
    let lines = splitlines(content); // .split('\r').join('').split('\n');
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
            let include = splitlines(s); // .split('\r').join('').split('\n');
            lines.splice(l, 1, ...include);
        }// else {
        //    lines[l] = line; // @TODO: This doesn't seem to be needed
        //}
    }
    return lines.join('\n');
}

/**
 * Normalized an id to lower-case, with hyphens instead of spaces
 *
 * @param {string} id
 * @returns {string}
 */
function cleanId(id) {
    return id.toLowerCase().replace(/\W/g, '-');
}

/**
 * If the provided value is a non-empty string, returns
 * the provided value, trimmed. Otherwise returns undefined.
 *
 * @param {string} strValue
 * @returns {string|undefined}
 */
function getStringValueOrUndefined(strValue) {
    let returnValue;
    if (typeof strValue === 'string') {
        if (strValue.trim() !== '') returnValue = strValue.trim();
    }
    return returnValue;
}

/**
 * Adds GitHub autolinks to automatically-generated headers and normalizes ids in the content
 *
 * @param {string} content
 * @returns {string}
 */
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

/**
 * Sanitizes code in the HTML
 *
 * @param {string} s
 * @returns {string}
 */
function clean(s) {
    if (!s) return '';
    if (GLOBAL_OPTIONS.unsafe) return s;
    let sanitizeOptions = {
        allowedTags: sanitizeHtml.defaults.allowedTags.concat(
            [ 'aside', 'h1', 'h2', 'i', 'span', 'img', 'button', 'aside', 'article', 'details', 'summary', 'abbr', 'meta', 'link' ]),
        allowedAttributes: {
            a: [ 'href', 'name', 'target', 'title', 'alt'],
            abbr: [ 'title', ],
            button: ['type'],
            details: [ 'open' ],
            div: [ 'role' ],
            img: [ 'src', 'alt', 'title' ],
            link: [ 'rel', 'href', 'type', 'sizes' ],
            meta: [ 'name', 'content' ],
        }
    };
    sanitizeOptions.allowedTags.map(tag => {
        if (typeof sanitizeOptions.allowedAttributes[tag] === 'undefined') {
            sanitizeOptions.allowedAttributes[tag] = [];
        }
        ['aria', 'class', 'id'].map(attr => {
            if (sanitizeOptions.allowedAttributes[tag].indexOf(attr) === -1) {
                sanitizeOptions.allowedAttributes[tag].push(attr);
            }
        });
    });

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

/**
 * Renders Markdown to HTML
 *
 * @param {string} inputStr
 * @param {ShinsOptions} options
 * @param {Function<err|undefined, string|undefined>} callback
 * @returns {void}
 */
function render(inputStr, options, callback) {

    if (options.attr === true) {
        md.use(attrs);
    }

    if (options.hasOwnProperty('no-links') && options['no-links'] === true) {
        md.disable('linkify');
    }

    if (typeof callback === 'undefined') { // for pre-v1.4.0 compatibility
        callback = options;
        options = {};
    }

    if (options.inline == true) {
        options.minify = true;
    }

    // Fallback for looking for files
    options.internal_source = new FolderGroup(path.resolve(SOURCE_LOCATION));
    // Where we'll copy assets from
    options.src = new FolderGroup(path.normalize(path.resolve(options.source
        ? options.source
        : SOURCE_LOCATION
    )));

    // Where assets will be copied to
    options.local = new FolderGroup(path.normalize(path.resolve(options.webRoot
        ? options.webRoot
        : LOCAL_WEB_ROOT
    )));

    let custom_template_file = resolvePath('/layouts/layout.ejs', options.src.root, options);
    EJS_TEMPLATE_FILE = custom_template_file
        ? custom_template_file
        : EJS_TEMPLATE_FILE;

    // Path for the root web directory
    options.web = new FolderGroup(path.parse(options.local.root).name);

    return maybe(callback, new Promise(function (resolve, reject) {
        GLOBAL_OPTIONS = options;
        ['logo-url'].map(function(option_key) {
            GLOBAL_OPTIONS[option_key] = getStringValueOrUndefined(GLOBAL_OPTIONS[option_key]);
            if (typeof GLOBAL_OPTIONS[option_key] === 'undefined') {
                delete GLOBAL_OPTIONS[option_key];
            }
        });

        inputStr = '\n' + splitlines(inputStr.trim()).join('\n'); // @TODO: Make this section a function?
        let inputArr = inputStr.split('\n---\n');
        let headerStr = inputArr[1];
        let header = yaml.safeLoad(headerStr);

        /* non-matching languages between Ruby Rouge and highlight.js at 2016/07/10 are
        ['ceylon','common_lisp','conf','cowscript','erb','factor','io','json-doc','liquid','literate_coffeescript','literate_haskell','llvm','make',
        'objective_c','plaintext','praat','properties','racket','sass','sed','shell','slim','sml','toml','tulip','viml'];*/
        let sh = hljs.getLanguage('bash');
        hljs.registerLanguage('shell', function (hljs) { return sh; });
        hljs.registerLanguage('sh', function (hljs) { return sh; });

        while (inputArr.length<3) inputArr.push(''); // Because there might not be a header?

        let content = preProcessMarkdown(inputArr[2], options);
        content = md.render(clean(content));
        content = postProcess(content);

        let locals = {};
        locals.current_page = {};
        locals.current_page.data = header;
        locals.page_content = content;
        locals.toc_data = function(content) { // @TODO: Move all of these functions upstairs
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
        locals.image_tag = function (image, altText, className) { // @TODO: Make a global tag library to be re-used
            let imageSource = resolvePath(image);
            let imageAlt = (typeof altText === 'undefined') ? '' : altText;
            let imageClass = (typeof className === 'undefined') ? '' : className;
            if (imageSource) {
                if (GLOBAL_OPTIONS.inline) {
                    var imgContent = safeReadFileSync(imageSource); // @TODO: Make a function that accepts a boolean value for whether the content of the file should be returned, or if it should be wrapped in a tag, with options
                    imageSource = "data:image/png;base64," + Buffer.from(imgContent).toString('base64');
                } else {
                    imageSource = copyToDest(GLOBAL_OPTIONS.local.img, imageSource);
                }
                return makeHTMLTag('img', {src: imageSource, class: imageClass, alt: imageAlt});
            } else {
                return '';
            }
        };
        locals.logo_image_tag = function () {
            if (!GLOBAL_OPTIONS.logo) return locals.image_tag('logo.png', 'Logo', 'logo');
            let imageSource = resolvePath(GLOBAL_OPTIONS.logo);
            if (imageSource) {
                if (GLOBAL_OPTIONS.inline) {
                    imageSource = "data:image/png;base64," + Buffer.from(safeReadFileSync(imageSource)).toString('base64');
                } else {
                    imageSource = copyToDest(GLOBAL_OPTIONS.local.img, imageSource);
                }
                imageSource = makeHTMLTag('img', {src: imageSource, class: "logo", alt: "Logo"});
                if (GLOBAL_OPTIONS['logo-url']) {
                    imageSource = makeHTMLTag('a', {href: md.utils.escapeHtml(GLOBAL_OPTIONS['logo-url'])}, imageSource);
                }
                return imageSource;
            } else {
                return '';
            }
        };

        locals.stylesheet_link_tag = includeStylesheetTag;
        locals.javascript_include_tag = includeJSTag;
        locals.language_array = toLanguageArray;

        let ejsOptions = {};
        ejsOptions.debug = false;
        ejs.renderFile(EJS_TEMPLATE_FILE, locals, ejsOptions, function (err, str) {
            if (err) reject(err)
            else resolve(str);
        });
    }));
}

module.exports = {
    render: render,
    srcDir: function () { return __dirname; }
};
