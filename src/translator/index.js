const querystring = require("querystring");
const { request } = require("undici");
const NodeCache = require("node-cache");
const cache = new NodeCache({ stdTTL: 86400 });

const languages = require("./languages");
const tokenGenerator = require("./token");

function makeError(code, message, cause){
    const err = new Error(message);
    err.code = code;
    if (cause) err.cause = cause;
    return err;
}

/**
 * @function translate
 * @param {String} text
 * @param {Object} options
 * @returns {Object}
 */
async function translate(text, options) {
    if(typeof options !== "object") options = {};
    text = String(text);

    // Validate given language codes if present
    let error;
    [ options.from, options.to ].forEach((lang) => {
        if (lang && !languages.isSupported(lang)) {
            error = makeError(400, `The language '${lang}' is not supported.`);
        }
    });
    if(error) throw error;

    // Normalize defaults before caching
    const fromISO = languages.getISOCode(Object.prototype.hasOwnProperty.call(options, "from") ? options.from : "auto");
    const toISO = languages.getISOCode(Object.prototype.hasOwnProperty.call(options, "to") ? options.to : "fr");
    options.raw = Boolean(options.raw);

    // Build a stable cache key (don’t depend on undefined pre-normalization)
    const cacheKey = `${fromISO}-${toISO}-${text}`;
    const cachedResult = cache.get(cacheKey);
    if(cachedResult){
        return cachedResult;
    }

    // Chunking for very long texts: split into pieces and merge results
    const maxChunkChars = Math.max(1, Number(options.maxChunkChars) || 4500);
    function chunkText(str, limit){
        if (str.length <= limit) return [str];
        const parts = [];
        const tokens = str.split(/(\s+)/); // keep spaces
        let current = '';
        for (const tok of tokens) {
            if ((current + tok).length > limit && current.length > 0) {
                parts.push(current);
                current = tok;
                while (current.length > limit) { // hard split huge tokens
                    parts.push(current.slice(0, limit));
                    current = current.slice(limit);
                }
            } else {
                current += tok;
            }
        }
        if (current) parts.push(current);
        return parts;
    }

    const chunks = chunkText(text, maxChunkChars);
    if (chunks.length > 1) {
        const merged = {
            text: '',
            from: { language: { didYouMean: false, iso: fromISO }, text: { autoCorrected: false, value: '', didYouMean: false } },
            raw: options.raw ? [] : ''
        };
        for (let i = 0; i < chunks.length; i++) {
            const r = await translate(chunks[i], { from: fromISO, to: toISO, raw: options.raw, maxChunkChars });
            merged.text += r.text;
            if (i === 0) merged.from = r.from;
            if (options.raw) merged.raw.push(r.raw);
        }
        cache.set(cacheKey, merged);
        return merged;
    }

    // Generate token and prepare request
    let token = await tokenGenerator.generate(text);
    if (token instanceof Error || !token || !token.name || !token.value) {
        throw makeError(503, 'Failed to generate translate token');
    }

    let baseUrl = "https://translate.google.com/translate_a/single";
    let data = {
        client: "gtx",
        sl: fromISO,
        tl: toISO,
        hl: toISO,
        dt: [ "at", "bd", "ex", "ld", "md", "qca", "rw", "rm", "ss", "t" ],
        ie: "UTF-8",
        oe: "UTF-8",
        otf: 1,
        ssel: 0,
        tsel: 0,
        kc: 7,
        q: text,
        [token.name]: token.value
    };

    let url = `${baseUrl}?${querystring.stringify(data)}`;

    let requestOptions;
    if(url.length > 2048){
        delete data.q;
        requestOptions = [
            `${baseUrl}?${querystring.stringify(data)}`,
            {
                method: "POST",
                body: new URLSearchParams({ q: text }).toString(),
                headers: {
                    "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
                },
            }
        ];
    }else{
        requestOptions = [ url ];
    }

    let response;
    try {
        response = await request(...requestOptions);
    } catch (e) {
        throw makeError(503, `Translate request failed: ${e.message}`, e);
    }
    if (response.statusCode && response.statusCode >= 400) {
        throw makeError(response.statusCode, `Translate request failed with status ${response.statusCode}`);
    }

    // Parse body safely (Google may change shapes)
    let body;
    try {
        body = await response.body.json();
    } catch (_) {
        // Fallback to text then JSON.parse if needed
        const txt = await response.body.text();
        try {
            body = JSON.parse(txt);
        } catch (e) {
            throw makeError(502, 'Unexpected translate response format', e);
        }
    }

    let result = {
        text: "",
        from: {
            language: {
                didYouMean: false,
                iso: ""
            },
            text: {
                autoCorrected: false,
                value: "",
                didYouMean: false
            }
        },
        raw: ""
    };

    if(options.raw){
        result.raw = body;
    }

    // Extract translation text (guard against unexpected structure)
    if (Array.isArray(body) && Array.isArray(body[0])) {
        for (const obj of body[0]) {
            if (obj && obj[0]) {
                result.text += obj[0];
            }
        }
    }

    // Language detection may live at indexes [2] and [8][0][0] on this endpoint
    const detectedIso = body?.[8]?.[0]?.[0] ?? body?.[2] ?? fromISO;
    if (detectedIso && detectedIso !== fromISO) {
        result.from.language.didYouMean = true;
        result.from.language.iso = detectedIso;
    } else {
        result.from.language.iso = detectedIso || fromISO;
    }

    // Spelling suggestions (index [7])
    if (Array.isArray(body?.[7]) && body[7][0]) {
        let str = body[7][0];
        str = str.replace(/<b><i>/g, "[").replace(/<\/i><\/b>/g, "]");
        result.from.text.value = str;
        if (body[7][5] === true) {
            result.from.text.autoCorrected = true;
        } else {
            result.from.text.didYouMean = true;
        }
    }

    cache.set(cacheKey, result);
    return result;
}

/**
 * @function loadLanguages
 * @param {Array<String>} languagesToLoad - The list of languages to load in the cache (in ISO 639-1)
 * @param {Array<String>} wordsToLoad - The list of words/phrases to load for each language
 * @returns {Promise}
 */
async function loadLanguages(languagesToLoad, wordsToLoad){
        if(!Array.isArray(languagesToLoad) || !Array.isArray(wordsToLoad)){
            throw makeError(400, 'Parameters must be arrays');
        }
  
    const translations = {};
    let langs = '';
    for(const lang of languagesToLoad){
        if(!languages.isSupported(lang)){
            throw makeError(400, `Language '${lang}' is not supported`);
        }
        langs += `${lang}, `
        translations[lang] = {};
    
        for(const word of wordsToLoad){
            const cacheKey = `${lang}-auto-${word}`;
            const cachedResult = cache.get(cacheKey);
    
            if(!cachedResult){
                const result = await translate(word, { to: lang });
                translations[lang][word] = result.text;
                cache.set(cacheKey, result);
            }else{
                translations[lang][word] = cachedResult.text;
            }
        }
    }
    
    langs = langs.slice(0, -2);
    console.log(`The languages "${langs}" have been loaded successfully.`)
    return translations;
}
  

module.exports = translate;
module.exports.languages = languages;
module.exports.loadLanguages = loadLanguages;