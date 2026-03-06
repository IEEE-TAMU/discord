import { Client, Events, Message } from 'discord.js';
import { DiscordModule } from './index';

const postMessageAsBot = async (bot_id: string, text: string, picture_url?: URL) => {
	return fetch('https://api.groupme.com/v3/bots/post', {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
		},
		body: JSON.stringify({
			bot_id,
			text,
			picture_url,
		}),
	}).catch((error) => console.error('Could not post message to GroupMe:', error));
};

interface ImageData {
	binaryData: Uint8Array<ArrayBuffer>;
	contentType: string;
}

interface ImageUploadResponse {
	payload: {
		url: URL;
		picture_url: URL;
	};
}

const uploadImage = async (accessToken: string, image: ImageData): Promise<ImageUploadResponse> => {
	return fetch('https://image.groupme.com/pictures', {
		method: 'POST',
		headers: {
			'X-Access-Token': accessToken,
			'Content-Type': image.contentType,
		},
		body: image.binaryData,
	})
		.then((response) => {
			if (!response.ok) {
				console.error('Response:', response);
				throw new Error(`Failed to upload image: ${response.status} ${response.statusText}`);
			}
			return response.json();
		})
		.catch((error) => console.error('Could not upload image to GroupMe:', error));
};

const MODULE_NAME = 'groupme';

export const groupmeModule: DiscordModule = {
	name: MODULE_NAME,
	start(client: Client) {
		const GROUPME_BOT_ID = process.env.GROUPME_BOT_ID;
		const GROUPME_TOKEN = process.env.GROUPME_TOKEN;
		const MONITOR_CHANNEL_ID = process.env.MONITOR_CHANNEL_ID;

		if (!GROUPME_BOT_ID || !GROUPME_TOKEN || !MONITOR_CHANNEL_ID) {
			return {
				enabled: false,
				missingRequirements: [
					!GROUPME_BOT_ID ? 'GROUPME_BOT_ID' : '',
					!GROUPME_TOKEN ? 'GROUPME_TOKEN' : '',
					!MONITOR_CHANNEL_ID ? 'MONITOR_CHANNEL_ID' : '',
				].filter(Boolean),
			};
		}

		async function postMessage(message: string, imageUrl?: string) {
			if (!imageUrl) {
				console.log(`${MODULE_NAME}: posting message: ${message}`);
				return postMessageAsBot(GROUPME_BOT_ID!, message);
			}
			console.log(`${MODULE_NAME}: uploading image from ${imageUrl}`);
			const image = await fetch(imageUrl).then(async (response) => {
				return {
					contentType: response.headers.get('Content-Type')!,
					binaryData: new Uint8Array(await response.arrayBuffer()),
				};
			});
			const { payload } = await uploadImage(GROUPME_TOKEN!, image);
			console.log(`${MODULE_NAME}: posting message with image: ${payload.picture_url}`);
			return postMessageAsBot(GROUPME_BOT_ID!, message, payload.picture_url);
		}

		client.on(Events.MessageCreate, async (msg: Message) => {
			if (msg.author.bot) return;
			if (msg.channelId !== MONITOR_CHANNEL_ID) return;
			if (msg.content === '' && msg.attachments.size === 0) return;
			console.log(`${MODULE_NAME}: received message from ${msg.author.tag}`);
			const message = msg.content;
			const attatchment = msg.attachments.first();
			const image_url = attatchment ? attatchment.url : undefined;
			console.log(`${MODULE_NAME}: forwarding message: ${message} with image: ${image_url}`);
			postMessage(message, image_url);
		});

		return { enabled: true };
	},
};
