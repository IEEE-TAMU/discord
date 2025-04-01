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
	}).catch(error => console.error('Could not post message to GroupMe:', error));
};

interface ImageData {
    binaryData: ArrayBuffer | Uint8Array | Buffer;
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
	}).then(response => response.json())
		.catch(error => console.error('Could not upload image to GroupMe:', error));
};

const GroupMeBot = {
	bot_id: process.env.GROUPME_BOT_ID || (function() {
		throw new Error('The GROUPME_BOT_ID environment variable is required.');
	})(),
	token: process.env.GROUPME_TOKEN || (function() {
		throw new Error('The GROUPME_TOKEN environment variable is required.');
	})(),
	postMessage: async function(message: string, imageUrl?: string) {
		if (!imageUrl) {
			console.log(`Posting message to GroupMe: ${message}`);
			return postMessageAsBot(this.bot_id, message);
		}
		console.log(`Uploading image from ${imageUrl} to GroupMe`);
		const image = await fetch(imageUrl).then(async response => {
			return {
				contentType: response.headers.get('Content-Type')!,
				binaryData: new Uint8Array(await response.arrayBuffer()),
			};
		});
		const { payload } = await uploadImage(this.token, image);
		console.log(`Posting message to GroupMe: ${message} with image: ${payload.picture_url}`);
		return postMessageAsBot(this.bot_id, message, payload.picture_url);
	},
};

export default GroupMeBot;