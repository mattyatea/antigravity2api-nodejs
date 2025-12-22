import { Hono } from 'hono';
// @ts-ignore
import { getAvailableModels, generateImageForSD } from '../api/client.js';
import { generateRequestBody } from '../converters/openai.js';

function prepareImageRequest(requestBody: any): any {
    const req = JSON.parse(JSON.stringify(requestBody));
    // SD specific adjustments
    if (req.request && req.request.generationConfig) {
        req.request.generationConfig.responseMimeType = 'image/jpeg';
        // Ensure sample count 1
        req.request.generationConfig.candidateCount = 1;
    }
    return req;
}
// @ts-ignore
import tokenManager from '../auth/token_manager.js';
import logger from '../utils/logger.js';

const sd = new Hono();

// Static data
const SD_MOCK_DATA = {
    options: {
        sd_model_checkpoint: 'gemini-3-pro-image',
        sd_vae: 'auto',
        CLIP_stop_at_last_layers: 1
    },
    samplers: [
        { name: 'Euler a', aliases: ['k_euler_a'] },
        { name: 'Euler', aliases: ['k_euler'] },
        { name: 'DPM++ 2M', aliases: ['k_dpmpp_2m'] },
        { name: 'DPM++ SDE', aliases: ['k_dpmpp_sde'] }
    ],
    schedulers: [
        { name: 'Automatic', label: 'Automatic' },
        { name: 'Uniform', label: 'Uniform' },
        { name: 'Karras', label: 'Karras' },
        { name: 'Exponential', label: 'Exponential' }
    ],
    upscalers: [
        { name: 'None', model_name: null, scale: 1 },
        { name: 'Lanczos', model_name: null, scale: 4 },
        { name: 'ESRGAN_4x', model_name: 'ESRGAN_4x', scale: 4 }
    ],
    latentUpscaleModes: [
        { name: 'Latent' },
        { name: 'Latent (antialiased)' },
        { name: 'Latent (bicubic)' },
        { name: 'Latent (nearest)' }
    ],
    vae: [
        { model_name: 'auto', filename: 'auto' },
        { model_name: 'None', filename: 'None' }
    ],
    modules: [
        { name: 'none', path: null },
        { name: 'LoRA', path: 'lora' }
    ],
    loras: [
        { name: 'example_lora_v1', alias: 'example_lora_v1', path: 'example_lora_v1.safetensors' },
        { name: 'style_lora', alias: 'style_lora', path: 'style_lora.safetensors' }
    ],
    embeddings: [
        { name: 'EasyNegative', step: 1, sd_checkpoint: null, sd_checkpoint_name: null },
        { name: 'badhandv4', step: 1, sd_checkpoint: null, sd_checkpoint_name: null }
    ],
    hypernetworks: [
        { name: 'example_hypernetwork', path: 'example_hypernetwork.pt' }
    ],
    scripts: [
        { name: 'None', is_alwayson: false, is_img2img: false },
        { name: 'X/Y/Z plot', is_alwayson: false, is_img2img: false }
    ],
    progress: {
        progress: 0,
        eta_relative: 0,
        state: { skipped: false, interrupted: false, job: '', job_count: 0, job_timestamp: '0', job_no: 0 },
        current_image: null,
        textinfo: null
    }
};

// Build image generation request body
function buildImageRequestBody(prompt: string, token: any) {
    const messages = [{ role: 'user', content: prompt }];
    const requestBody = generateRequestBody(messages, 'gemini-3-pro-image', {}, null, token);
    return prepareImageRequest(requestBody);
}

// GET routes
sd.get('/sd-models', async (c) => {
    try {
        const models = await getAvailableModels();
        const imageModels = models.data
            .filter((m: any) => m.id.includes('-image'))
            .map((m: any) => ({
                title: m.id,
                model_name: m.id,
                hash: null,
                sha256: null,
                filename: m.id,
                config: null
            }));
        return c.json(imageModels);
    } catch (error: any) {
        logger.error('Failed to get SD model list:', error.message);
        return c.json({ error: error.message }, 500);
    }
});

sd.get('/options', (c) => c.json(SD_MOCK_DATA.options));
sd.get('/samplers', (c) => c.json(SD_MOCK_DATA.samplers));
sd.get('/schedulers', (c) => c.json(SD_MOCK_DATA.schedulers));
sd.get('/upscalers', (c) => c.json(SD_MOCK_DATA.upscalers));
sd.get('/latent-upscale-modes', (c) => c.json(SD_MOCK_DATA.latentUpscaleModes));
sd.get('/sd-vae', (c) => c.json(SD_MOCK_DATA.vae));
sd.get('/sd-modules', (c) => c.json(SD_MOCK_DATA.modules));
sd.get('/loras', (c) => c.json(SD_MOCK_DATA.loras));
sd.get('/embeddings', (c) => c.json({ loaded: SD_MOCK_DATA.embeddings, skipped: {} }));
sd.get('/hypernetworks', (c) => c.json(SD_MOCK_DATA.hypernetworks));
sd.get('/scripts', (c) => c.json({ txt2img: SD_MOCK_DATA.scripts, img2img: SD_MOCK_DATA.scripts }));
sd.get('/script-info', (c) => c.json([]));
sd.get('/progress', (c) => c.json(SD_MOCK_DATA.progress));
sd.get('/cmd-flags', (c) => c.json({}));
sd.get('/memory', (c) => c.json({ ram: { free: 8589934592, used: 8589934592, total: 17179869184 }, cuda: { system: { free: 0, used: 0, total: 0 } } }));

// POST routes
sd.post('/img2img', async (c) => {
    const body = await c.req.json();
    const { prompt, init_images } = body;

    try {
        if (!prompt) {
            return c.json({ error: 'prompt is required' }, 400);
        }

        const token = await tokenManager.getToken();
        if (!token) {
            throw new Error('No available token');
        }

        // Build messages including images
        const content: any[] = [{ type: 'text', text: prompt }];
        if (init_images && init_images.length > 0) {
            init_images.forEach((img: string) => {
                const format = img.startsWith('/9j/') ? 'jpeg' : 'png';
                content.push({ type: 'image_url', image_url: { url: `data:image/${format};base64,${img}` } });
            });
        }

        const messages = [{ role: 'user', content }];
        const requestBody = prepareImageRequest(
            generateRequestBody(messages, 'gemini-3-pro-image', {}, null, token)
        );

        const images = await generateImageForSD(requestBody, token);

        if (images.length === 0) {
            throw new Error('Image not generated');
        }

        return c.json({
            images,
            parameters: body,
            info: JSON.stringify({ prompt })
        });
    } catch (error: any) {
        logger.error('SD img2img failed:', error.message);
        return c.json({ error: error.message }, 500);
    }
});

sd.post('/txt2img', async (c) => {
    const body = await c.req.json();
    const { prompt, negative_prompt, steps, cfg_scale, width, height, seed, sampler_name } = body;

    try {
        if (!prompt) {
            return c.json({ error: 'prompt is required' }, 400);
        }

        const token = await tokenManager.getToken();
        if (!token) {
            throw new Error('No available token');
        }

        const requestBody = buildImageRequestBody(prompt, token);
        const images = await generateImageForSD(requestBody, token);

        if (images.length === 0) {
            throw new Error('Image not generated');
        }

        return c.json({
            images,
            parameters: { prompt, negative_prompt, steps, cfg_scale, width, height, seed, sampler_name },
            info: JSON.stringify({ prompt, seed: seed || -1 })
        });
    } catch (error: any) {
        logger.error('SD txt2img failed:', error.message);
        return c.json({ error: error.message }, 500);
    }
});

sd.post('/options', (c) => c.json({}));
sd.post('/refresh-checkpoints', (c) => c.json(null));
sd.post('/refresh-loras', (c) => c.json(null));
sd.post('/interrupt', (c) => c.json(null));
sd.post('/skip', (c) => c.json(null));

export default sd;
