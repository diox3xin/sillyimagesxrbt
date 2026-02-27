const MODULE_NAME = 'inline_image_gen';

const processingMessages = new Set();

const logBuffer = [];
const MAX_LOG_ENTRIES = 200;

function iigLog(level, ...args) {
    const timestamp = new Date().toISOString();
    const message = args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ');
    const entry = `[${timestamp}] [${level}] ${message}`;

    logBuffer.push(entry);
    if (logBuffer.length > MAX_LOG_ENTRIES) {
        logBuffer.shift();
    }

    if (level === 'ERROR') {
        console.error('[IIG]', ...args);
    } else if (level === 'WARN') {
        console.warn('[IIG]', ...args);
    } else {
        console.log('[IIG]', ...args);
    }
}

function exportLogs() {
    const logsText = logBuffer.join('\n');
    const blob = new Blob([logsText], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `iig-logs-${new Date().toISOString().replace(/[:.]/g, '-')}.txt`;
    a.click();
    URL.revokeObjectURL(url);
    toastr.success('Логи экспортированы', 'Генерация картинок');
}

const defaultSettings = Object.freeze({
    enabled: true,
    apiType: 'openai',
    endpoint: '',
    apiKey: '',
    model: '',
    size: '1024x1024',
    quality: 'standard',
    maxRetries: 0,
    retryDelay: 1000,
    sendCharAvatar: false,
    sendUserAvatar: false,
    userAvatarFile: '',
    aspectRatio: '1:1',
    imageSize: '1K',
    naisteraAspectRatio: '1:1',
    naisteraPreset: '',
    naisteraSendCharAvatar: false,
    naisteraSendUserAvatar: false,
    sendPreviousImages: true,
    maxPreviousImages: 2,
    sendStyleReference: true,
    sendNpcReferences: true,
    npcReferenceImages: {},
});

const IMAGE_MODEL_KEYWORDS = [
    'dall-e', 'midjourney', 'mj', 'journey', 'stable-diffusion', 'sdxl', 'flux',
    'imagen', 'drawing', 'paint', 'image', 'seedream', 'hidream', 'dreamshaper',
    'ideogram', 'nano-banana', 'gpt-image', 'wanx', 'qwen'
];

const VIDEO_MODEL_KEYWORDS = [
    'sora', 'kling', 'jimeng', 'veo', 'pika', 'runway', 'luma',
    'video', 'gen-3', 'minimax', 'cogvideo', 'mochi', 'seedance',
    'vidu', 'wan-ai', 'hunyuan', 'hailuo'
];

function isImageModel(modelId) {
    const mid = modelId.toLowerCase();

    for (const kw of VIDEO_MODEL_KEYWORDS) {
        if (mid.includes(kw)) return false;
    }

    if (mid.includes('vision') && mid.includes('preview')) return false;

    for (const kw of IMAGE_MODEL_KEYWORDS) {
        if (mid.includes(kw)) return true;
    }

    return false;
}

function isGeminiModel(modelId) {
    const mid = modelId.toLowerCase();
    return mid.includes('nano-banana');
}

function getSettings() {
    const context = SillyTavern.getContext();

    if (!context.extensionSettings[MODULE_NAME]) {
        context.extensionSettings[MODULE_NAME] = structuredClone(defaultSettings);
    }

    for (const key of Object.keys(defaultSettings)) {
        if (!Object.hasOwn(context.extensionSettings[MODULE_NAME], key)) {
            context.extensionSettings[MODULE_NAME][key] = defaultSettings[key];
        }
    }

    return context.extensionSettings[MODULE_NAME];
}

function saveSettings() {
    const context = SillyTavern.getContext();
    context.saveSettingsDebounced();
}

async function fetchModels() {
    const settings = getSettings();

    if (!settings.endpoint || !settings.apiKey) {
        console.warn('[IIG] Cannot fetch models: endpoint or API key not set');
        return [];
    }

    const url = `${settings.endpoint.replace(/\/$/, '')}/v1/models`;

    try {
        const response = await fetch(url, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${settings.apiKey}`
            }
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const data = await response.json();
        const models = data.data || [];

        return models.filter(m => isImageModel(m.id)).map(m => m.id);
    } catch (error) {
        console.error('[IIG] Failed to fetch models:', error);
        toastr.error(`Ошибка загрузки моделей: ${error.message}`, 'Генерация картинок');
        return [];
    }
}

async function fetchUserAvatars() {
    try {
        const context = SillyTavern.getContext();
        const response = await fetch('/api/avatars/get', {
            method: 'POST',
            headers: context.getRequestHeaders(),
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        return await response.json();
    } catch (error) {
        console.error('[IIG] Failed to fetch user avatars:', error);
        return [];
    }
}

async function imageUrlToBase64(url) {
    try {
        const response = await fetch(url);
        const blob = await response.blob();

        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => {
                const base64 = reader.result.split(',')[1];
                resolve(base64);
            };
            reader.onerror = reject;
            reader.readAsDataURL(blob);
        });
    } catch (error) {
        console.error('[IIG] Failed to convert image to base64:', error);
        return null;
    }
}

async function imageUrlToDataUrl(url) {
    try {
        const response = await fetch(url);
        const blob = await response.blob();

        return await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
        });
    } catch (error) {
        console.error('[IIG] Failed to convert image to data URL:', error);
        return null;
    }
}

async function saveImageToFile(dataUrl) {
    const context = SillyTavern.getContext();

    if (dataUrl && !dataUrl.startsWith('data:') && (dataUrl.startsWith('http://') || dataUrl.startsWith('https://'))) {
        iigLog('INFO', 'Converting external URL to data URL via FileReader...');
        const converted = await imageUrlToDataUrl(dataUrl);
        if (!converted) {
            throw new Error('Failed to convert external URL to data URL');
        }
        dataUrl = converted;
    }

    const commaIndex = dataUrl.indexOf(',');
    if (commaIndex === -1 || !dataUrl.startsWith('data:image/')) {
        throw new Error('Invalid data URL format');
    }

    const metaPart = dataUrl.substring(0, commaIndex);
    const formatMatch = metaPart.match(/image\/(\w+)/);
    const format = formatMatch ? formatMatch[1] : 'png';
    const base64Data = dataUrl.substring(commaIndex + 1);

    let charName = 'generated';
    if (context.characterId !== undefined && context.characters?.[context.characterId]) {
        charName = context.characters[context.characterId].name || 'generated';
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `iig_${timestamp}`;

    const response = await fetch('/api/images/upload', {
        method: 'POST',
        headers: context.getRequestHeaders(),
        body: JSON.stringify({
            image: base64Data,
            format: format,
            ch_name: charName,
            filename: filename
        })
    });

    if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Unknown error' }));
        throw new Error(error.error || `Upload failed: ${response.status}`);
    }

    const result = await response.json();
    iigLog('INFO', `Image saved to: ${result.path}`);
    return result.path;
}

async function getCharacterAvatarBase64() {
    try {
        const context = SillyTavern.getContext();

        if (context.characterId === undefined || context.characterId === null) {
            return null;
        }

        if (typeof context.getCharacterAvatar === 'function') {
            const avatarUrl = context.getCharacterAvatar(context.characterId);
            if (avatarUrl) {
                return await imageUrlToBase64(avatarUrl);
            }
        }

        const character = context.characters?.[context.characterId];
        if (character?.avatar) {
            const avatarUrl = `/characters/${encodeURIComponent(character.avatar)}`;
            return await imageUrlToBase64(avatarUrl);
        }

        return null;
    } catch (error) {
        console.error('[IIG] Error getting character avatar:', error);
        return null;
    }
}

async function getCharacterAvatarDataUrl() {
    try {
        const context = SillyTavern.getContext();

        if (context.characterId === undefined || context.characterId === null) {
            return null;
        }

        if (typeof context.getCharacterAvatar === 'function') {
            const avatarUrl = context.getCharacterAvatar(context.characterId);
            if (avatarUrl) {
                return await imageUrlToDataUrl(avatarUrl);
            }
        }

        const character = context.characters?.[context.characterId];
        if (character?.avatar) {
            const avatarUrl = `/characters/${encodeURIComponent(character.avatar)}`;
            return await imageUrlToDataUrl(avatarUrl);
        }

        return null;
    } catch (error) {
        console.error('[IIG] Error getting character avatar data URL:', error);
        return null;
    }
}

async function getUserAvatarBase64() {
    try {
        const settings = getSettings();

        if (!settings.userAvatarFile) {
            return null;
        }

        const avatarUrl = `/User Avatars/${encodeURIComponent(settings.userAvatarFile)}`;
        return await imageUrlToBase64(avatarUrl);
    } catch (error) {
        console.error('[IIG] Error getting user avatar:', error);
        return null;
    }
}

async function getUserAvatarDataUrl() {
    try {
        const settings = getSettings();
        if (!settings.userAvatarFile) {
            return null;
        }
        const avatarUrl = `/User Avatars/${encodeURIComponent(settings.userAvatarFile)}`;
        return await imageUrlToDataUrl(avatarUrl);
    } catch (error) {
        console.error('[IIG] Error getting user avatar data URL:', error);
        return null;
    }
}

async function collectReferenceImages(prompt, currentMessageId) {
    const context = SillyTavern.getContext();
    const settings = getSettings();
    const result = { previous: [], style: null, npcs: [] };

    if (!context.chat || context.chat.length === 0) {
        return result;
    }

    const generatedImages = [];

    for (let i = context.chat.length - 1; i >= 0; i--) {
        if (i === currentMessageId) continue;

        const message = context.chat[i];
        if (!message || !message.mes) continue;

        const imgPathRegex = /src=["']?(\/user\/images\/[^"'\s>]+)["']?/gi;
        let match;

        while ((match = imgPathRegex.exec(message.mes)) !== null) {
            const imgPath = match[1];
            if (imgPath.includes('iig_')) {
                generatedImages.push({
                    path: imgPath,
                    messageIndex: i
                });
            }
        }
    }

    iigLog('INFO', `Found ${generatedImages.length} previously generated images in chat history`);

    if (settings.sendStyleReference && generatedImages.length > 0) {
        const oldestImage = generatedImages[generatedImages.length - 1];
        const styleDataUrl = await imageUrlToDataUrl(oldestImage.path);
        if (styleDataUrl) {
            result.style = styleDataUrl;
            iigLog('INFO', `Style reference: ${oldestImage.path}`);
        }
    }

    if (settings.sendPreviousImages && generatedImages.length > 0) {
        const maxPrev = Math.min(settings.maxPreviousImages || 2, 4);
        const endIdx = Math.min(maxPrev, generatedImages.length - (result.style ? 1 : 0));

        for (let i = 0; i < endIdx; i++) {
            const imgPath = generatedImages[i].path;
            const dataUrl = await imageUrlToDataUrl(imgPath);
            if (dataUrl) {
                result.previous.push(dataUrl);
            }
        }
        iigLog('INFO', `Previous references: ${result.previous.length} images`);
    }

    if (settings.sendNpcReferences && settings.npcReferenceImages) {
        const promptLower = prompt.toLowerCase();

        for (const [npcName, npcImagePath] of Object.entries(settings.npcReferenceImages)) {
            if (!npcImagePath) continue;

            if (promptLower.includes(npcName.toLowerCase())) {
                const npcDataUrl = await imageUrlToDataUrl(npcImagePath);
                if (npcDataUrl) {
                    result.npcs.push(npcDataUrl);
                    iigLog('INFO', `NPC reference found: ${npcName} -> ${npcImagePath}`);
                }
            }
        }
    }

    return result;
}

async function generateImageOpenAI(prompt, style, referenceImages = [], options = {}) {
    const settings = getSettings();
    const url = `${settings.endpoint.replace(/\/$/, '')}/v1/images/generations`;

    const fullPrompt = style ? `[Style: ${style}] ${prompt}` : prompt;

    let size = settings.size;
    if (options.aspectRatio) {
        if (options.aspectRatio === '16:9') size = '1792x1024';
        else if (options.aspectRatio === '9:16') size = '1024x1792';
        else if (options.aspectRatio === '1:1') size = '1024x1024';
    }

    const body = {
        model: settings.model,
        prompt: fullPrompt,
        n: 1,
        size: size,
        quality: options.quality || settings.quality,
        response_format: 'b64_json'
    };

    if (referenceImages.length > 0) {
        body.image = `data:image/png;base64,${referenceImages[0]}`;
    }

    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${settings.apiKey}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
    });

    if (!response.ok) {
        const text = await response.text();
        throw new Error(`API Error (${response.status}): ${text}`);
    }

    const result = await response.json();

    const dataList = result.data || [];
    if (dataList.length === 0) {
        if (result.url) return result.url;
        throw new Error('No image data in response');
    }

    const imageObj = dataList[0];

    if (imageObj.b64_json) {
        return `data:image/png;base64,${imageObj.b64_json}`;
    }

    return imageObj.url;
}

const VALID_ASPECT_RATIOS = ['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9'];
const VALID_IMAGE_SIZES = ['1K', '2K', '4K'];

async function generateImageGemini(prompt, style, referenceImages = [], options = {}) {
    const settings = getSettings();
    const model = settings.model;
    const url = `${settings.endpoint.replace(/\/$/, '')}/v1beta/models/${model}:generateContent`;

    let aspectRatio = options.aspectRatio || settings.aspectRatio || '1:1';
    if (!VALID_ASPECT_RATIOS.includes(aspectRatio)) {
        aspectRatio = VALID_ASPECT_RATIOS.includes(settings.aspectRatio) ? settings.aspectRatio : '1:1';
    }

    let imageSize = options.imageSize || settings.imageSize || '1K';
    if (!VALID_IMAGE_SIZES.includes(imageSize)) {
        imageSize = VALID_IMAGE_SIZES.includes(settings.imageSize) ? settings.imageSize : '1K';
    }

    iigLog('INFO', `Using aspect ratio: ${aspectRatio}, image size: ${imageSize}`);

    const parts = [];

    for (const imgB64 of referenceImages.slice(0, 4)) {
        parts.push({
            inlineData: {
                mimeType: 'image/png',
                data: imgB64
            }
        });
    }

    let fullPrompt = style ? `[Style: ${style}] ${prompt}` : prompt;

    if (referenceImages.length > 0) {
        const refInstruction = `[CRITICAL REFERENCE INSTRUCTIONS:
You are provided with ${referenceImages.length} reference image(s). These MUST be used as follows:
- Reference 1: This is the PRIMARY STYLE/CHARACTER reference. Copy the exact art style, color palette, lighting, and if a character - their complete appearance (face, hair, body, clothing).
${referenceImages.length >= 2 ? '- Reference 2+: Additional character references or previous images from this scene. Maintain EXACT visual consistency with these.' : ''}

MANDATORY:
- Match the art style EXACTLY (brushwork, colors, rendering technique)
- Character faces MUST look identical to references
- Clothing and accessories MUST match unless explicitly changed in prompt
- Maintain the same level of detail and quality

DO NOT: Create generic/different looking characters. Every named character MUST match their reference exactly.]

`;
        fullPrompt = refInstruction + fullPrompt;
    }

    parts.push({ text: fullPrompt });

    iigLog('INFO', `Gemini request: ${referenceImages.length} reference image(s) + prompt (${fullPrompt.length} chars)`);

    const body = {
        contents: [{
            role: 'user',
            parts: parts
        }],
        generationConfig: {
            responseModalities: ['TEXT', 'IMAGE'],
            imageConfig: {
                aspectRatio: aspectRatio,
                imageSize: imageSize
            }
        }
    };

    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${settings.apiKey}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
    });

    if (!response.ok) {
        const text = await response.text();
        throw new Error(`API Error (${response.status}): ${text}`);
    }

    const result = await response.json();

    const candidates = result.candidates || [];
    if (candidates.length === 0) {
        throw new Error('No candidates in response');
    }

    const responseParts = candidates[0].content?.parts || [];

    for (const part of responseParts) {
        if (part.inlineData) {
            return `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
        }
        if (part.inline_data) {
            return `data:${part.inline_data.mime_type};base64,${part.inline_data.data}`;
        }
    }

    throw new Error('No image found in Gemini response');
}

async function generateImageNaistera(prompt, style, options = {}) {
    const settings = getSettings();
    const endpoint = settings.endpoint.replace(/\/$/, '');
    const url = endpoint.endsWith('/api/generate') ? endpoint : `${endpoint}/api/generate`;

    const fullPrompt = style ? `[Style: ${style}] ${prompt}` : prompt;

    const aspectRatio = options.aspectRatio || settings.naisteraAspectRatio || '1:1';
    const preset = options.preset || settings.naisteraPreset || null;
    const referenceImages = options.referenceImages || [];

    const body = {
        prompt: fullPrompt,
        aspect_ratio: aspectRatio,
    };
    if (preset) body.preset = preset;
    if (referenceImages.length > 0) body.reference_images = referenceImages.slice(0, 4);

    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${settings.apiKey}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
    });

    if (!response.ok) {
        const text = await response.text();
        throw new Error(`API Error (${response.status}): ${text}`);
    }

    const result = await response.json();
    if (!result?.data_url) {
        throw new Error('No data_url in response');
    }

    return result.data_url;
}

function validateSettings() {
    const settings = getSettings();
    const errors = [];

    if (!settings.endpoint) {
        errors.push('URL эндпоинта не настроен');
    }
    if (!settings.apiKey) {
        errors.push('API ключ не настроен');
    }
    if (settings.apiType !== 'naistera' && !settings.model) {
        errors.push('Модель не выбрана');
    }

    if (errors.length > 0) {
        throw new Error(`Ошибка настроек: ${errors.join(', ')}`);
    }
}

function sanitizeForHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

async function generateImageWithRetry(prompt, style, onStatusUpdate, options = {}) {
    validateSettings();

    const settings = getSettings();
    const maxRetries = settings.maxRetries;
    const baseDelay = settings.retryDelay;

    const referenceImages = [];
    const referenceDataUrls = [];

    onStatusUpdate?.('Сбор референсов...');
    const chatRefs = await collectReferenceImages(prompt, options.messageId);

    if (settings.apiType === 'gemini' || isGeminiModel(settings.model)) {
        if (settings.sendCharAvatar) {
            const charAvatar = await getCharacterAvatarBase64();
            if (charAvatar) referenceImages.push(charAvatar);
        }
        if (settings.sendUserAvatar) {
            const userAvatar = await getUserAvatarBase64();
            if (userAvatar) referenceImages.push(userAvatar);
        }

        if (chatRefs.style) {
            const styleB64 = chatRefs.style.split(',')[1];
            if (styleB64) referenceImages.push(styleB64);
        }

        for (const prevDataUrl of chatRefs.previous) {
            if (referenceImages.length >= 4) break;
            const b64 = prevDataUrl.split(',')[1];
            if (b64) referenceImages.push(b64);
        }

        for (const npcDataUrl of chatRefs.npcs) {
            if (referenceImages.length >= 4) break;
            const b64 = npcDataUrl.split(',')[1];
            if (b64) referenceImages.push(b64);
        }

        iigLog('INFO', `Total Gemini references: ${referenceImages.length}`);
    }

    if (settings.apiType === 'naistera') {
        if (settings.naisteraSendCharAvatar) {
            const d = await getCharacterAvatarDataUrl();
            if (d) referenceDataUrls.push(d);
        }
        if (settings.naisteraSendUserAvatar) {
            const d = await getUserAvatarDataUrl();
            if (d) referenceDataUrls.push(d);
        }

        if (chatRefs.style) referenceDataUrls.push(chatRefs.style);
        for (const prev of chatRefs.previous) {
            if (referenceDataUrls.length >= 4) break;
            referenceDataUrls.push(prev);
        }
        for (const npc of chatRefs.npcs) {
            if (referenceDataUrls.length >= 4) break;
            referenceDataUrls.push(npc);
        }

        iigLog('INFO', `Total Naistera references: ${referenceDataUrls.length}`);
    }

    let lastError;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            onStatusUpdate?.(`Генерация${attempt > 0 ? ` (повтор ${attempt}/${maxRetries})` : ''}...`);

            if (settings.apiType === 'naistera') {
                return await generateImageNaistera(prompt, style, { ...options, referenceImages: referenceDataUrls });
            } else if (settings.apiType === 'gemini' || isGeminiModel(settings.model)) {
                return await generateImageGemini(prompt, style, referenceImages, options);
            } else {
                return await generateImageOpenAI(prompt, style, referenceImages, options);
            }
        } catch (error) {
            lastError = error;
            iigLog('ERROR', `Generation attempt ${attempt + 1} failed:`, error.message);

            const isRetryable = error.message?.includes('429') ||
                               error.message?.includes('503') ||
                               error.message?.includes('502') ||
                               error.message?.includes('504') ||
                               error.message?.includes('timeout') ||
                               error.message?.includes('network');

            if (!isRetryable || attempt === maxRetries) {
                break;
            }

            const delay = baseDelay * Math.pow(2, attempt);
            onStatusUpdate?.(`Повтор через ${delay / 1000}с...`);
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }

    throw lastError;
}

async function checkFileExists(path) {
    try {
        const response = await fetch(path, { method: 'HEAD' });
        return response.ok;
    } catch (e) {
        return false;
    }
}

async function parseImageTags(text, options = {}) {
    const { checkExistence = false, forceAll = false } = options;
    const tags = [];

    const imgTagMarker = 'data-iig-instruction=';
    let searchPos = 0;

    while (true) {
        const markerPos = text.indexOf(imgTagMarker, searchPos);
        if (markerPos === -1) break;

        let imgStart = text.lastIndexOf('<img', markerPos);
        if (imgStart === -1 || markerPos - imgStart > 500) {
            searchPos = markerPos + 1;
            continue;
        }

        const afterMarker = markerPos + imgTagMarker.length;
        let jsonStart = text.indexOf('{', afterMarker);
        if (jsonStart === -1 || jsonStart > afterMarker + 10) {
            searchPos = markerPos + 1;
            continue;
        }

        let braceCount = 0;
        let jsonEnd = -1;
        let inString = false;
        let escapeNext = false;

        for (let i = jsonStart; i < text.length; i++) {
            const char = text[i];

            if (escapeNext) {
                escapeNext = false;
                continue;
            }

            if (char === '\\' && inString) {
                escapeNext = true;
                continue;
            }

            if (char === '"') {
                inString = !inString;
                continue;
            }

            if (!inString) {
                if (char === '{') {
                    braceCount++;
                } else if (char === '}') {
                    braceCount--;
                    if (braceCount === 0) {
                        jsonEnd = i + 1;
                        break;
                    }
                }
            }
        }

        if (jsonEnd === -1) {
            searchPos = markerPos + 1;
            continue;
        }

        let imgEnd = text.indexOf('>', jsonEnd);
        if (imgEnd === -1) {
            searchPos = markerPos + 1;
            continue;
        }
        imgEnd++;

        const fullImgTag = text.substring(imgStart, imgEnd);
        const instructionJson = text.substring(jsonStart, jsonEnd);

        const srcMatch = fullImgTag.match(/src\s*=\s*["']?([^"'\s>]+)/i);
        const srcValue = srcMatch ? srcMatch[1] : '';

        let needsGeneration = false;
        const hasMarker = srcValue.includes('[IMG:GEN]') || srcValue.includes('[IMG:');
        const hasErrorImage = srcValue.includes('error.svg');
        const hasPath = srcValue && srcValue.startsWith('/') && srcValue.length > 5;

        if (hasErrorImage && !forceAll) {
            searchPos = imgEnd;
            continue;
        }

        if (forceAll) {
            needsGeneration = true;
        } else if (hasMarker || !srcValue) {
            needsGeneration = true;
        } else if (hasPath && checkExistence) {
            const exists = await checkFileExists(srcValue);
            if (!exists) {
                iigLog('WARN', `File does not exist (LLM hallucination?): ${srcValue}`);
                needsGeneration = true;
            }
        } else if (hasPath) {
            searchPos = imgEnd;
            continue;
        }

        if (!needsGeneration) {
            searchPos = imgEnd;
            continue;
        }

        try {
            let normalizedJson = instructionJson
                .replace(/"/g, '"')
                .replace(/'/g, "'")
                .replace(/'/g, "'")
                .replace(/"/g, '"')
                .replace(/&/g, '&');

            const data = JSON.parse(normalizedJson);

            tags.push({
                fullMatch: fullImgTag,
                index: imgStart,
                style: data.style || '',
                prompt: data.prompt || '',
                aspectRatio: data.aspect_ratio || data.aspectRatio || null,
                preset: data.preset || null,
                imageSize: data.image_size || data.imageSize || null,
                quality: data.quality || null,
                isNewFormat: true,
                existingSrc: hasPath ? srcValue : null
            });

            iigLog('INFO', `Found NEW format tag: ${data.prompt?.substring(0, 50)}`);
        } catch (e) {
            iigLog('WARN', `Failed to parse instruction JSON: ${instructionJson.substring(0, 100)}`, e.message);
        }

        searchPos = imgEnd;
    }

    const marker = '[IMG:GEN:';
    let searchStart = 0;

    while (true) {
        const markerIndex = text.indexOf(marker, searchStart);
        if (markerIndex === -1) break;

        const jsonStart = markerIndex + marker.length;

        let braceCount = 0;
        let jsonEnd = -1;
        let inString = false;
        let escapeNext = false;

        for (let i = jsonStart; i < text.length; i++) {
            const char = text[i];

            if (escapeNext) {
                escapeNext = false;
                continue;
            }

            if (char === '\\' && inString) {
                escapeNext = true;
                continue;
            }

            if (char === '"') {
                inString = !inString;
                continue;
            }

            if (!inString) {
                if (char === '{') {
                    braceCount++;
                } else if (char === '}') {
                    braceCount--;
                    if (braceCount === 0) {
                        jsonEnd = i + 1;
                        break;
                    }
                }
            }
        }

        if (jsonEnd === -1) {
            searchStart = jsonStart;
            continue;
        }

        const jsonStr = text.substring(jsonStart, jsonEnd);

        const afterJson = text.substring(jsonEnd);
        if (!afterJson.startsWith(']')) {
            searchStart = jsonEnd;
            continue;
        }

        const tagOnly = text.substring(markerIndex, jsonEnd + 1);

        try {
            const normalizedJson = jsonStr.replace(/'/g, '"');
            const data = JSON.parse(normalizedJson);

            tags.push({
                fullMatch: tagOnly,
                index: markerIndex,
                style: data.style || '',
                prompt: data.prompt || '',
                aspectRatio: data.aspect_ratio || data.aspectRatio || null,
                preset: data.preset || null,
                imageSize: data.image_size || data.imageSize || null,
                quality: data.quality || null,
                isNewFormat: false
            });

            iigLog('INFO', `Found LEGACY format tag: ${data.prompt?.substring(0, 50)}`);
        } catch (e) {
            iigLog('WARN', `Failed to parse legacy tag JSON: ${jsonStr.substring(0, 100)}`, e.message);
        }

        searchStart = jsonEnd + 1;
    }

    return tags;
}

function createLoadingPlaceholder(tagId) {
    const placeholder = document.createElement('div');
    placeholder.className = 'iig-loading-placeholder';
    placeholder.dataset.tagId = tagId;
    placeholder.innerHTML = `
        <div class="iig-spinner"></div>
        <div class="iig-status">Генерация картинки...</div>
    `;
    return placeholder;
}

const ERROR_IMAGE_PATH = '/scripts/extensions/third-party/sillyimages/error.svg';

function createErrorPlaceholder(tagId, errorMessage, tagInfo) {
    const img = document.createElement('img');
    img.className = 'iig-error-image';
    img.src = ERROR_IMAGE_PATH;
    img.alt = 'Ошибка генерации';
    img.title = `Ошибка: ${errorMessage}`;
    img.dataset.tagId = tagId;

    if (tagInfo.fullMatch) {
        const instructionMatch = tagInfo.fullMatch.match(/data-iig-instruction\s*=\s*(['"])([\s\S]*?)\1/i);
        if (instructionMatch) {
            img.setAttribute('data-iig-instruction', instructionMatch[2]);
        }
    }

    return img;
}

async function processMessageTags(messageId) {
    const context = SillyTavern.getContext();
    const settings = getSettings();

    if (!settings.enabled) return;

    if (processingMessages.has(messageId)) {
        iigLog('WARN', `Message ${messageId} is already being processed, skipping`);
        return;
    }

    const message = context.chat[messageId];
    if (!message || message.is_user) return;

    const tags = await parseImageTags(message.mes, { checkExistence: true });
    iigLog('INFO', `parseImageTags returned: ${tags.length} tags`);
    if (tags.length === 0) {
        iigLog('INFO', 'No tags found by parser');
        return;
    }

    processingMessages.add(messageId);
    iigLog('INFO', `Found ${tags.length} image tag(s) in message ${messageId}`);
    toastr.info(`Найдено тегов: ${tags.length}. Генерация...`, 'Генерация картинок', { timeOut: 3000 });

    const messageElement = document.querySelector(`#chat .mes[mesid="${messageId}"]`);
    if (!messageElement) {
        console.error('[IIG] Message element not found for ID:', messageId);
        processingMessages.delete(messageId);
        toastr.error('Не удалось найти элемент сообщения', 'Генерация картинок');
        return;
    }

    const mesTextEl = messageElement.querySelector('.mes_text');
    if (!mesTextEl) {
        processingMessages.delete(messageId);
        return;
    }

    const processTag = async (tag, index) => {
        const tagId = `iig-${messageId}-${index}`;

        iigLog('INFO', `Processing tag ${index}: ${tag.fullMatch.substring(0, 50)}`);

        const loadingPlaceholder = createLoadingPlaceholder(tagId);
        let targetElement = null;

        if (tag.isNewFormat) {
            const allImgs = mesTextEl.querySelectorAll('img[data-iig-instruction]');
            const searchPrompt = tag.prompt.substring(0, 30);

            for (const img of allImgs) {
                const instruction = img.getAttribute('data-iig-instruction');
                const src = img.getAttribute('src') || '';

                if (instruction) {
                    const decodedInstruction = instruction
                        .replace(/"/g, '"')
                        .replace(/'/g, "'")
                        .replace(/'/g, "'")
                        .replace(/"/g, '"')
                        .replace(/&/g, '&');

                    const normalizedSearchPrompt = searchPrompt
                        .replace(/"/g, '"')
                        .replace(/'/g, "'")
                        .replace(/'/g, "'")
                        .replace(/"/g, '"')
                        .replace(/&/g, '&');

                    if (decodedInstruction.includes(normalizedSearchPrompt)) {
                        targetElement = img;
                        break;
                    }

                    try {
                        const normalizedJson = decodedInstruction.replace(/'/g, '"');
                        const instructionData = JSON.parse(normalizedJson);
                        if (instructionData.prompt && instructionData.prompt.substring(0, 30) === tag.prompt.substring(0, 30)) {
                            targetElement = img;
                            break;
                        }
                    } catch (e) {}

                    if (instruction.includes(searchPrompt)) {
                        targetElement = img;
                        break;
                    }
                }
            }

            if (!targetElement) {
                for (const img of allImgs) {
                    const src = img.getAttribute('src') || '';
                    if (src.includes('[IMG:GEN]') || src.includes('[IMG:ERROR]') || src === '' || src === '#') {
                        targetElement = img;
                        break;
                    }
                }
            }

            if (!targetElement) {
                const allImgsInMes = mesTextEl.querySelectorAll('img');
                for (const img of allImgsInMes) {
                    const src = img.getAttribute('src') || '';
                    if (src.includes('[IMG:GEN]') || src.includes('[IMG:ERROR]')) {
                        targetElement = img;
                        break;
                    }
                }
            }
        } else {
            const tagEscaped = tag.fullMatch
                .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
                .replace(/"/g, '(?:"|")');
            const tagRegex = new RegExp(tagEscaped, 'g');

            const beforeReplace = mesTextEl.innerHTML;
            mesTextEl.innerHTML = mesTextEl.innerHTML.replace(
                tagRegex,
                `<span data-iig-placeholder="${tagId}"></span>`
            );

            if (beforeReplace !== mesTextEl.innerHTML) {
                targetElement = mesTextEl.querySelector(`[data-iig-placeholder="${tagId}"]`);
            }

            if (!targetElement) {
                const allImgs = mesTextEl.querySelectorAll('img');
                for (const img of allImgs) {
                    if (img.src && img.src.includes('[IMG:GEN:')) {
                        targetElement = img;
                        break;
                    }
                }
            }
        }

        if (targetElement) {
            const parent = targetElement.parentElement;
            if (parent) {
                const parentStyle = window.getComputedStyle(parent);
                if (parentStyle.display === 'flex' || parentStyle.display === 'grid') {
                    loadingPlaceholder.style.alignSelf = 'center';
                }
            }
            targetElement.replaceWith(loadingPlaceholder);
        } else {
            mesTextEl.appendChild(loadingPlaceholder);
        }

        const statusEl = loadingPlaceholder.querySelector('.iig-status');

        try {
            const dataUrl = await generateImageWithRetry(
                tag.prompt,
                tag.style,
                (status) => { statusEl.textContent = status; },
                { aspectRatio: tag.aspectRatio, imageSize: tag.imageSize, quality: tag.quality, preset: tag.preset, messageId: messageId }
            );

            statusEl.textContent = 'Сохранение...';
            const imagePath = await saveImageToFile(dataUrl);

            const img = document.createElement('img');
            img.className = 'iig-generated-image';
            img.src = imagePath;
            img.alt = tag.prompt;
            img.title = `Style: ${tag.style}\nPrompt: ${tag.prompt}`;

            if (tag.isNewFormat) {
                const instructionMatch = tag.fullMatch.match(/data-iig-instruction\s*=\s*(['"])([\s\S]*?)\1/i);
                if (instructionMatch) {
                    img.setAttribute('data-iig-instruction', instructionMatch[2]);
                }
            }

            loadingPlaceholder.replaceWith(img);

            if (tag.isNewFormat) {
                const updatedTag = tag.fullMatch.replace(/src\s*=\s*(['"])[^'"]*\1/i, `src="${imagePath}"`);
                message.mes = message.mes.replace(tag.fullMatch, updatedTag);
            } else {
                const completionMarker = `[IMG:✓:${imagePath}]`;
                message.mes = message.mes.replace(tag.fullMatch, completionMarker);
            }

            iigLog('INFO', `Successfully generated image for tag ${index}`);
            toastr.success(`Картинка ${index + 1}/${tags.length} готова`, 'Генерация картинок', { timeOut: 2000 });
        } catch (error) {
            iigLog('ERROR', `Failed to generate image for tag ${index}:`, error.message);

            const errorPlaceholder = createErrorPlaceholder(tagId, error.message, tag);
            loadingPlaceholder.replaceWith(errorPlaceholder);

            if (tag.isNewFormat) {
                const errorTag = tag.fullMatch.replace(/src\s*=\s*(['"])[^'"]*\1/i, `src="${ERROR_IMAGE_PATH}"`);
                message.mes = message.mes.replace(tag.fullMatch, errorTag);
            } else {
                const errorMarker = `[IMG:ERROR:${error.message.substring(0, 50)}]`;
                message.mes = message.mes.replace(tag.fullMatch, errorMarker);
            }

            toastr.error(`Ошибка генерации: ${error.message}`, 'Генерация картинок');
        }
    };

    try {
        await Promise.all(tags.map((tag, index) => processTag(tag, index)));
        await context.saveChat();
        iigLog('INFO', `Finished processing message ${messageId}`);
    } finally {
        processingMessages.delete(messageId);
    }
}

async function regenerateMessageImages(messageId) {
    const context = SillyTavern.getContext();
    const message = context.chat[messageId];

    if (!message) {
        toastr.error('Сообщение не найдено', 'Генерация картинок');
        return;
    }

    const tags = await parseImageTags(message.mes, { forceAll: true });

    if (tags.length === 0) {
        toastr.warning('Нет тегов для перегенерации', 'Генерация картинок');
        return;
    }

    iigLog('INFO', `Regenerating ${tags.length} images in message ${messageId}`);
    toastr.info(`Перегенерация ${tags.length} картинок...`, 'Генерация картинок');

    processingMessages.add(messageId);

    const messageElement = document.querySelector(`#chat .mes[mesid="${messageId}"]`);
    if (!messageElement) {
        processingMessages.delete(messageId);
        return;
    }

    const mesTextEl = messageElement.querySelector('.mes_text');
    if (!mesTextEl) {
        processingMessages.delete(messageId);
        return;
    }

    for (let index = 0; index < tags.length; index++) {
        const tag = tags[index];
        const tagId = `iig-regen-${messageId}-${index}`;

        try {
            const existingImg = mesTextEl.querySelector(`img[data-iig-instruction]`);
            if (existingImg) {
                const instruction = existingImg.getAttribute('data-iig-instruction');

                const loadingPlaceholder = createLoadingPlaceholder(tagId);
                existingImg.replaceWith(loadingPlaceholder);

                const statusEl = loadingPlaceholder.querySelector('.iig-status');

                const dataUrl = await generateImageWithRetry(
                    tag.prompt,
                    tag.style,
                    (status) => { statusEl.textContent = status; },
                    { aspectRatio: tag.aspectRatio, imageSize: tag.imageSize, quality: tag.quality, preset: tag.preset, messageId: messageId }
                );

                statusEl.textContent = 'Сохранение...';
                const imagePath = await saveImageToFile(dataUrl);

                const img = document.createElement('img');
                img.className = 'iig-generated-image';
                img.src = imagePath;
                img.alt = tag.prompt;
                if (instruction) {
                    img.setAttribute('data-iig-instruction', instruction);
                }
                loadingPlaceholder.replaceWith(img);

                const updatedTag = tag.fullMatch.replace(/src\s*=\s*(['"])[^'"]*\1/i, `src="${imagePath}"`);
                message.mes = message.mes.replace(tag.fullMatch, updatedTag);

                toastr.success(`Картинка ${index + 1}/${tags.length} готова`, 'Генерация картинок', { timeOut: 2000 });
            }
        } catch (error) {
            iigLog('ERROR', `Regeneration failed for tag ${index}:`, error.message);
            toastr.error(`Ошибка: ${error.message}`, 'Генерация картинок');
        }
    }

    processingMessages.delete(messageId);
    await context.saveChat();
    iigLog('INFO', `Regeneration complete for message ${messageId}`);
}

function addRegenerateButton(messageElement, messageId) {
    if (messageElement.querySelector('.iig-regenerate-btn')) return;

    const extraMesButtons = messageElement.querySelector('.extraMesButtons');
    if (!extraMesButtons) return;

    const btn = document.createElement('div');
    btn.className = 'mes_button iig-regenerate-btn fa-solid fa-images interactable';
    btn.title = 'Перегенерировать картинки';
    btn.tabIndex = 0;
    btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        await regenerateMessageImages(messageId);
    });

    extraMesButtons.appendChild(btn);
}

function addButtonsToExistingMessages() {
    const context = SillyTavern.getContext();
    if (!context.chat || context.chat.length === 0) return;

    const messageElements = document.querySelectorAll('#chat .mes');
    let addedCount = 0;

    for (const messageElement of messageElements) {
        const mesId = messageElement.getAttribute('mesid');
        if (mesId === null) continue;

        const messageId = parseInt(mesId, 10);
        const message = context.chat[messageId];

        if (message && !message.is_user) {
            addRegenerateButton(messageElement, messageId);
            addedCount++;
        }
    }

    iigLog('INFO', `Added regenerate buttons to ${addedCount} existing messages`);
}

async function onMessageReceived(messageId) {
    iigLog('INFO', `onMessageReceived: ${messageId}`);

    const settings = getSettings();
    if (!settings.enabled) {
        iigLog('INFO', 'Extension disabled, skipping');
        return;
    }

    const context = SillyTavern.getContext();
    const message = context.chat[messageId];

    const messageElement = document.querySelector(`#chat .mes[mesid="${messageId}"]`);
    if (!messageElement) return;

    addRegenerateButton(messageElement, messageId);

    await processMessageTags(messageId);
}

function renderNpcList() {
    const settings = getSettings();
    const container = document.getElementById('iig_npc_list');
    if (!container) return;

    const npcs = settings.npcReferenceImages || {};

    if (Object.keys(npcs).length === 0) {
        container.innerHTML = '<p class="hint">Нет добавленных NPC</p>';
        return;
    }

    container.innerHTML = Object.entries(npcs).map(([name, path]) => `
        <div class="iig-npc-item flex-row" data-npc="${name}">
            <span class="iig-npc-name">${name}</span>
            <input type="text" class="text_pole flex1 iig-npc-path"
                   value="${path}" placeholder="/user/images/..."
                   data-npc="${name}">
            <div class="menu_button iig-npc-delete" data-npc="${name}" title="Удалить">
                <i class="fa-solid fa-trash"></i>
            </div>
        </div>
    `).join('');

    container.querySelectorAll('.iig-npc-path').forEach(input => {
        input.addEventListener('input', (e) => {
            const npcName = e.target.dataset.npc;
            settings.npcReferenceImages[npcName] = e.target.value;
            saveSettings();
        });
    });

    container.querySelectorAll('.iig-npc-delete').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const npcName = e.currentTarget.dataset.npc;
            delete settings.npcReferenceImages[npcName];
            saveSettings();
            renderNpcList();
            toastr.info(`NPC "${npcName}" удалён`, 'Генерация картинок');
        });
    });
}

function createSettingsUI() {
    const settings = getSettings();
    const context = SillyTavern.getContext();

    const container = document.getElementById('extensions_settings');
    if (!container) {
        console.error('[IIG] Settings container not found');
        return;
    }

    const html = `
        <div class="inline-drawer">
            <div class="inline-drawer-toggle inline-drawer-header">
                <b>Генерация картинок</b>
                <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
            </div>
            <div class="inline-drawer-content">
                <div class="iig-settings">
                    <label class="checkbox_label">
                        <input type="checkbox" id="iig_enabled" ${settings.enabled ? 'checked' : ''}>
                        <span>Включить генерацию картинок</span>
                    </label>

                    <hr>

                    <h4>Настройки API</h4>

                    <div class="flex-row">
                        <label for="iig_api_type">Тип API</label>
                        <select id="iig_api_type" class="flex1">
                            <option value="openai" ${settings.apiType === 'openai' ? 'selected' : ''}>OpenAI-совместимый (/v1/images/generations)</option>
                            <option value="gemini" ${settings.apiType === 'gemini' ? 'selected' : ''}>Gemini-совместимый (nano-banana)</option>
                            <option value="naistera" ${settings.apiType === 'naistera' ? 'selected' : ''}>Naistera/Grok (naistera.org)</option>
                        </select>
                    </div>

                    <div class="flex-row">
                        <label for="iig_endpoint">URL эндпоинта</label>
                        <input type="text" id="iig_endpoint" class="text_pole flex1"
                               value="${settings.endpoint}"
                               placeholder="https://api.example.com">
                    </div>

                    <div class="flex-row">
                        <label for="iig_api_key">API ключ</label>
                        <input type="password" id="iig_api_key" class="text_pole flex1"
                               value="${settings.apiKey}">
                        <div id="iig_key_toggle" class="menu_button iig-key-toggle" title="Показать/Скрыть">
                            <i class="fa-solid fa-eye"></i>
                        </div>
                    </div>
                    <p id="iig_naistera_hint" class="hint ${settings.apiType === 'naistera' ? '' : 'iig-hidden'}">Для Naistera/Grok: вставьте токен из Telegram бота. Модель не требуется.</p>

                    <div class="flex-row ${settings.apiType === 'naistera' ? 'iig-hidden' : ''}" id="iig_model_row">
                        <label for="iig_model">Модель</label>
                        <select id="iig_model" class="flex1">
                            ${settings.model ? `<option value="${settings.model}" selected>${settings.model}</option>` : '<option value="">-- Выберите модель --</option>'}
                        </select>
                        <div id="iig_refresh_models" class="menu_button iig-refresh-btn" title="Обновить список">
                            <i class="fa-solid fa-sync"></i>
                        </div>
                    </div>

                    <hr>

                    <h4>Параметры генерации</h4>

                    <div class="flex-row ${settings.apiType !== 'openai' ? 'iig-hidden' : ''}" id="iig_size_row">
                        <label for="iig_size">Размер</label>
                        <select id="iig_size" class="flex1">
                            <option value="1024x1024" ${settings.size === '1024x1024' ? 'selected' : ''}>1024x1024 (Квадрат)</option>
                            <option value="1792x1024" ${settings.size === '1792x1024' ? 'selected' : ''}>1792x1024 (Альбомная)</option>
                            <option value="1024x1792" ${settings.size === '1024x1792' ? 'selected' : ''}>1024x1792 (Портретная)</option>
                            <option value="512x512" ${settings.size === '512x512' ? 'selected' : ''}>512x512 (Маленький)</option>
                        </select>
                    </div>

                    <div class="flex-row ${settings.apiType !== 'openai' ? 'iig-hidden' : ''}" id="iig_quality_row">
                        <label for="iig_quality">Качество</label>
                        <select id="iig_quality" class="flex1">
                            <option value="standard" ${settings.quality === 'standard' ? 'selected' : ''}>Стандартное</option>
                            <option value="hd" ${settings.quality === 'hd' ? 'selected' : ''}>HD</option>
                        </select>
                    </div>

                    <div class="flex-row ${settings.apiType === 'naistera' ? '' : 'iig-hidden'}" id="iig_naistera_aspect_row">
                        <label for="iig_naistera_aspect_ratio">Соотношение сторон</label>
                        <select id="iig_naistera_aspect_ratio" class="flex1">
                            <option value="1:1" ${settings.naisteraAspectRatio === '1:1' ? 'selected' : ''}>1:1</option>
                            <option value="3:2" ${settings.naisteraAspectRatio === '3:2' ? 'selected' : ''}>3:2</option>
                            <option value="2:3" ${settings.naisteraAspectRatio === '2:3' ? 'selected' : ''}>2:3</option>
                        </select>
                    </div>
                    <div class="flex-row ${settings.apiType === 'naistera' ? '' : 'iig-hidden'}" id="iig_naistera_preset_row">
                        <label for="iig_naistera_preset">Пресеты</label>
                        <select id="iig_naistera_preset" class="flex1">
                            <option value="" ${!settings.naisteraPreset ? 'selected' : ''}>без пресета</option>
                            <option value="digital" ${settings.naisteraPreset === 'digital' ? 'selected' : ''}>digital</option>
                            <option value="realism" ${settings.naisteraPreset === 'realism' ? 'selected' : ''}>realism</option>
                        </select>
                    </div>

                    <div class="iig-naistera-refs ${settings.apiType === 'naistera' ? '' : 'iig-hidden'}" id="iig_naistera_refs_section">
                        <h4>Референсы Naistera</h4>
                        <p class="hint">Отправлять аватарки как референсы для консистентной генерации персонажей.</p>
                        <label class="checkbox_label">
                            <input type="checkbox" id="iig_naistera_send_char_avatar" ${settings.naisteraSendCharAvatar ? 'checked' : ''}>
                            <span>Отправлять аватар персонажа</span>
                        </label>
                        <label class="checkbox_label">
                            <input type="checkbox" id="iig_naistera_send_user_avatar" ${settings.naisteraSendUserAvatar ? 'checked' : ''}>
                            <span>Отправлять аватар пользователя</span>
                        </label>

                        <div id="iig_naistera_user_avatar_row" class="flex-row ${!settings.naisteraSendUserAvatar ? 'iig-hidden' : ''}" style="margin-top: 5px;">
                            <label for="iig_naistera_user_avatar_file">Аватар пользователя</label>
                            <select id="iig_naistera_user_avatar_file" class="flex1">
                                <option value="">-- Не выбран --</option>
                                ${settings.userAvatarFile ? `<option value="${settings.userAvatarFile}" selected>${settings.userAvatarFile}</option>` : ''}
                            </select>
                            <div id="iig_naistera_refresh_avatars" class="menu_button iig-refresh-btn" title="Обновить список">
                                <i class="fa-solid fa-sync"></i>
                            </div>
                        </div>
                    </div>

                    <hr>

                    <div id="iig_avatar_section" class="iig-avatar-section ${settings.apiType !== 'gemini' ? 'hidden' : ''}">
                        <h4>Настройки Nano-Banana</h4>

                        <div class="flex-row">
                            <label for="iig_aspect_ratio">Соотношение сторон</label>
                            <select id="iig_aspect_ratio" class="flex1">
                                <option value="1:1" ${settings.aspectRatio === '1:1' ? 'selected' : ''}>1:1 (Квадрат)</option>
                                <option value="2:3" ${settings.aspectRatio === '2:3' ? 'selected' : ''}>2:3 (Портрет)</option>
                                <option value="3:2" ${settings.aspectRatio === '3:2' ? 'selected' : ''}>3:2 (Альбом)</option>
                                <option value="3:4" ${settings.aspectRatio === '3:4' ? 'selected' : ''}>3:4 (Портрет)</option>
                                <option value="4:3" ${settings.aspectRatio === '4:3' ? 'selected' : ''}>4:3 (Альбом)</option>
                                <option value="4:5" ${settings.aspectRatio === '4:5' ? 'selected' : ''}>4:5 (Портрет)</option>
                                <option value="5:4" ${settings.aspectRatio === '5:4' ? 'selected' : ''}>5:4 (Альбом)</option>
                                <option value="9:16" ${settings.aspectRatio === '9:16' ? 'selected' : ''}>9:16 (Вертикальный)</option>
                                <option value="16:9" ${settings.aspectRatio === '16:9' ? 'selected' : ''}>16:9 (Широкий)</option>
                                <option value="21:9" ${settings.aspectRatio === '21:9' ? 'selected' : ''}>21:9 (Ультраширокий)</option>
                            </select>
                        </div>

                        <div class="flex-row">
                            <label for="iig_image_size">Разрешение</label>
                            <select id="iig_image_size" class="flex1">
                                <option value="1K" ${settings.imageSize === '1K' ? 'selected' : ''}>1K (по умолчанию)</option>
                                <option value="2K" ${settings.imageSize === '2K' ? 'selected' : ''}>2K</option>
                                <option value="4K" ${settings.imageSize === '4K' ? 'selected' : ''}>4K</option>
                            </select>
                        </div>

                        <hr>

                        <h5>Референсы Nano-Banana</h5>
                        <p class="hint">Отправлять аватарки как референсы для консистентной генерации персонажей.</p>

                        <label class="checkbox_label">
                            <input type="checkbox" id="iig_send_char_avatar" ${settings.sendCharAvatar ? 'checked' : ''}>
                            <span>Отправлять аватар персонажа</span>
                        </label>

                        <label class="checkbox_label">
                            <input type="checkbox" id="iig_send_user_avatar" ${settings.sendUserAvatar ? 'checked' : ''}>
                            <span>Отправлять аватар пользователя</span>
                        </label>

                        <div id="iig_user_avatar_row" class="flex-row ${!settings.sendUserAvatar ? 'hidden' : ''}" style="margin-top: 5px;">
                            <label for="iig_user_avatar_file">Аватар пользователя</label>
                            <select id="iig_user_avatar_file" class="flex1">
                                <option value="">-- Не выбран --</option>
                                ${settings.userAvatarFile ? `<option value="${settings.userAvatarFile}" selected>${settings.userAvatarFile}</option>` : ''}
                            </select>
                            <div id="iig_refresh_avatars" class="menu_button iig-refresh-btn" title="Обновить список">
                                <i class="fa-solid fa-sync"></i>
                            </div>
                        </div>
                    </div>

                    <hr>

                    <h4>Референсы из истории</h4>

                    <label class="checkbox_label">
                        <input type="checkbox" id="iig_send_previous_images" ${settings.sendPreviousImages ? 'checked' : ''}>
                        <span>Отправлять предыдущие картинки как референсы</span>
                    </label>

                    <div class="flex-row ${!settings.sendPreviousImages ? 'iig-hidden' : ''}" id="iig_max_prev_row">
                        <label for="iig_max_previous_images">Макс. предыдущих картинок</label>
                        <input type="number" id="iig_max_previous_images" class="text_pole"
                               value="${settings.maxPreviousImages || 2}" min="1" max="4" style="width: 60px;">
                    </div>

                    <label class="checkbox_label">
                        <input type="checkbox" id="iig_send_style_reference" ${settings.sendStyleReference ? 'checked' : ''}>
                        <span>Первая картинка = style reference</span>
                    </label>

                    <hr>

                    <div id="iig_npc_section" class="iig-npc-section">
                        <h4>NPC Референсы</h4>
                        <p class="hint">Загрузите картинки для NPC персонажей. Расширение автоматически найдёт их имена в промпте и отправит как референсы.</p>

                        <div id="iig_npc_list" class="iig-npc-list">
                        </div>

                        <div class="flex-row" style="margin-top: 10px;">
                            <input type="text" id="iig_new_npc_name" class="text_pole flex1" placeholder="Имя NPC (например: Luca)">
                            <div id="iig_add_npc" class="menu_button" title="Добавить NPC">
                                <i class="fa-solid fa-plus"></i>
                            </div>
                        </div>
                    </div>

                    <hr>

                    <h4>Обработка ошибок</h4>

                    <div class="flex-row">
                        <label for="iig_max_retries">Макс. повторов</label>
                        <input type="number" id="iig_max_retries" class="text_pole flex1"
                               value="${settings.maxRetries}" min="0" max="5">
                    </div>

                    <div class="flex-row">
                        <label for="iig_retry_delay">Задержка (мс)</label>
                        <input type="number" id="iig_retry_delay" class="text_pole flex1"
                               value="${settings.retryDelay}" min="500" max="10000" step="500">
                    </div>

                    <hr>

                    <h4>Отладка</h4>

                    <div class="flex-row">
                        <div id="iig_export_logs" class="menu_button" style="width: 100%;">
                            <i class="fa-solid fa-download"></i> Экспорт логов
                        </div>
                    </div>
                    <p class="hint">Экспортировать логи расширения для отладки проблем.</p>
                </div>
            </div>
        </div>
    `;

    container.insertAdjacentHTML('beforeend', html);

    bindSettingsEvents();
}

function bindSettingsEvents() {
    const settings = getSettings();

    const updateVisibility = () => {
        const apiType = settings.apiType;
        const isNaistera = apiType === 'naistera';
        const isGemini = apiType === 'gemini';
        const isOpenAI = apiType === 'openai';

        document.getElementById('iig_model_row')?.classList.toggle('iig-hidden', isNaistera);

        document.getElementById('iig_size_row')?.classList.toggle('iig-hidden', !isOpenAI);
        document.getElementById('iig_quality_row')?.classList.toggle('iig-hidden', !isOpenAI);

        document.getElementById('iig_naistera_aspect_row')?.classList.toggle('iig-hidden', !isNaistera);
        document.getElementById('iig_naistera_preset_row')?.classList.toggle('iig-hidden', !isNaistera);
        document.getElementById('iig_naistera_refs_section')?.classList.toggle('iig-hidden', !isNaistera);
        document.getElementById('iig_naistera_user_avatar_row')?.classList.toggle('iig-hidden', !(isNaistera && settings.naisteraSendUserAvatar));

        document.getElementById('iig_naistera_hint')?.classList.toggle('iig-hidden', !isNaistera);

        const avatarSection = document.getElementById('iig_avatar_section');
        if (avatarSection) {
            avatarSection.classList.toggle('hidden', !isGemini);
        }
    };

    document.getElementById('iig_enabled')?.addEventListener('change', (e) => {
        settings.enabled = e.target.checked;
        saveSettings();
    });

    document.getElementById('iig_api_type')?.addEventListener('change', (e) => {
        settings.apiType = e.target.value;
        saveSettings();
        updateVisibility();
    });

    document.getElementById('iig_endpoint')?.addEventListener('input', (e) => {
        settings.endpoint = e.target.value;
        saveSettings();
    });

    document.getElementById('iig_api_key')?.addEventListener('input', (e) => {
        settings.apiKey = e.target.value;
        saveSettings();
    });

    document.getElementById('iig_key_toggle')?.addEventListener('click', () => {
        const input = document.getElementById('iig_api_key');
        const icon = document.querySelector('#iig_key_toggle i');
        if (input.type === 'password') {
            input.type = 'text';
            icon.classList.replace('fa-eye', 'fa-eye-slash');
        } else {
            input.type = 'password';
            icon.classList.replace('fa-eye-slash', 'fa-eye');
        }
    });

    document.getElementById('iig_model')?.addEventListener('change', (e) => {
        settings.model = e.target.value;
        saveSettings();

        if (isGeminiModel(e.target.value)) {
            document.getElementById('iig_api_type').value = 'gemini';
            settings.apiType = 'gemini';
            updateVisibility();
        }
    });

    document.getElementById('iig_refresh_models')?.addEventListener('click', async (e) => {
        const btn = e.currentTarget;
        btn.classList.add('loading');

        try {
            const models = await fetchModels();
            const select = document.getElementById('iig_model');

            const currentModel = settings.model;

            select.innerHTML = '<option value="">-- Выберите модель --</option>';

            for (const model of models) {
                const option = document.createElement('option');
                option.value = model;
                option.textContent = model;
                option.selected = model === currentModel;
                select.appendChild(option);
            }

            toastr.success(`Найдено моделей: ${models.length}`, 'Генерация картинок');
        } catch (error) {
            toastr.error('Ошибка загрузки моделей', 'Генерация картинок');
        } finally {
            btn.classList.remove('loading');
        }
    });

    document.getElementById('iig_size')?.addEventListener('change', (e) => {
        settings.size = e.target.value;
        saveSettings();
    });

    document.getElementById('iig_quality')?.addEventListener('change', (e) => {
        settings.quality = e.target.value;
        saveSettings();
    });

    document.getElementById('iig_aspect_ratio')?.addEventListener('change', (e) => {
        settings.aspectRatio = e.target.value;
        saveSettings();
    });

    document.getElementById('iig_image_size')?.addEventListener('change', (e) => {
        settings.imageSize = e.target.value;
        saveSettings();
    });

    document.getElementById('iig_naistera_aspect_ratio')?.addEventListener('change', (e) => {
        settings.naisteraAspectRatio = e.target.value;
        saveSettings();
    });

    document.getElementById('iig_naistera_preset')?.addEventListener('change', (e) => {
        settings.naisteraPreset = e.target.value;
        saveSettings();
    });

    document.getElementById('iig_naistera_send_char_avatar')?.addEventListener('change', (e) => {
        settings.naisteraSendCharAvatar = e.target.checked;
        saveSettings();
    });
    document.getElementById('iig_naistera_send_user_avatar')?.addEventListener('change', (e) => {
        settings.naisteraSendUserAvatar = e.target.checked;
        saveSettings();
        updateVisibility();
    });

    document.getElementById('iig_naistera_user_avatar_file')?.addEventListener('change', (e) => {
        settings.userAvatarFile = e.target.value;
        saveSettings();
    });

    document.getElementById('iig_naistera_refresh_avatars')?.addEventListener('click', async (e) => {
        const btn = e.currentTarget;
        btn.classList.add('loading');

        try {
            const avatars = await fetchUserAvatars();
            const select = document.getElementById('iig_naistera_user_avatar_file');
            const currentAvatar = settings.userAvatarFile;

            select.innerHTML = '<option value="">-- Не выбран --</option>';

            for (const avatar of avatars) {
                const option = document.createElement('option');
                option.value = avatar;
                option.textContent = avatar;
                option.selected = avatar === currentAvatar;
                select.appendChild(option);
            }

            toastr.success(`Найдено аватаров: ${avatars.length}`, 'Генерация картинок');
        } catch (error) {
            toastr.error('Ошибка загрузки аватаров', 'Генерация картинок');
        } finally {
            btn.classList.remove('loading');
        }
    });

    document.getElementById('iig_send_char_avatar')?.addEventListener('change', (e) => {
        settings.sendCharAvatar = e.target.checked;
        saveSettings();
    });

    document.getElementById('iig_send_user_avatar')?.addEventListener('change', (e) => {
        settings.sendUserAvatar = e.target.checked;
        saveSettings();

        const avatarRow = document.getElementById('iig_user_avatar_row');
        if (avatarRow) {
            avatarRow.classList.toggle('hidden', !e.target.checked);
        }
    });

    document.getElementById('iig_user_avatar_file')?.addEventListener('change', (e) => {
        settings.userAvatarFile = e.target.value;
        saveSettings();
    });

    document.getElementById('iig_refresh_avatars')?.addEventListener('click', async (e) => {
        const btn = e.currentTarget;
        btn.classList.add('loading');

        try {
            const avatars = await fetchUserAvatars();
            const select = document.getElementById('iig_user_avatar_file');
            const currentAvatar = settings.userAvatarFile;

            select.innerHTML = '<option value="">-- Не выбран --</option>';

            for (const avatar of avatars) {
                const option = document.createElement('option');
                option.value = avatar;
                option.textContent = avatar;
                option.selected = avatar === currentAvatar;
                select.appendChild(option);
            }

            toastr.success(`Найдено аватаров: ${avatars.length}`, 'Генерация картинок');
        } catch (error) {
            toastr.error('Ошибка загрузки аватаров', 'Генерация картинок');
        } finally {
            btn.classList.remove('loading');
        }
    });

    document.getElementById('iig_send_previous_images')?.addEventListener('change', (e) => {
        settings.sendPreviousImages = e.target.checked;
        saveSettings();
        document.getElementById('iig_max_prev_row')?.classList.toggle('iig-hidden', !e.target.checked);
    });

    document.getElementById('iig_max_previous_images')?.addEventListener('input', (e) => {
        settings.maxPreviousImages = Math.min(4, Math.max(1, parseInt(e.target.value) || 2));
        saveSettings();
    });

    document.getElementById('iig_send_style_reference')?.addEventListener('change', (e) => {
        settings.sendStyleReference = e.target.checked;
        saveSettings();
    });

    document.getElementById('iig_add_npc')?.addEventListener('click', () => {
        const nameInput = document.getElementById('iig_new_npc_name');
        const name = nameInput.value.trim();
        if (!name) {
            toastr.warning('Введите имя NPC', 'Генерация картинок');
            return;
        }

        if (!settings.npcReferenceImages) {
            settings.npcReferenceImages = {};
        }

        if (settings.npcReferenceImages[name]) {
            toastr.warning('NPC с таким именем уже существует', 'Генерация картинок');
            return;
        }

        settings.npcReferenceImages[name] = '';
        saveSettings();
        renderNpcList();
        nameInput.value = '';
        toastr.success(`NPC "${name}" добавлен`, 'Генерация картинок');
    });

    document.getElementById('iig_max_retries')?.addEventListener('input', (e) => {
        settings.maxRetries = parseInt(e.target.value) || 3;
        saveSettings();
    });

    document.getElementById('iig_retry_delay')?.addEventListener('input', (e) => {
        settings.retryDelay = parseInt(e.target.value) || 1000;
        saveSettings();
    });

    document.getElementById('iig_export_logs')?.addEventListener('click', () => {
        exportLogs();
    });

    updateVisibility();
    renderNpcList();
}

(function init() {
    const context = SillyTavern.getContext();

    getSettings();

    context.eventSource.on(context.event_types.APP_READY, () => {
        createSettingsUI();
        addButtonsToExistingMessages();
        console.log('[IIG] Inline Image Generation extension loaded');
    });

    context.eventSource.on(context.event_types.CHAT_CHANGED, () => {
        iigLog('INFO', 'CHAT_CHANGED event - adding buttons to existing messages');
        setTimeout(() => {
            addButtonsToExistingMessages();
        }, 100);
    });

    const handleMessage = async (messageId) => {
        console.log('[IIG] Event triggered for message:', messageId);
        await onMessageReceived(messageId);
    };

    context.eventSource.makeLast(context.event_types.CHARACTER_MESSAGE_RENDERED, handleMessage);

    console.log('[IIG] Inline Image Generation extension initialized');
})();
