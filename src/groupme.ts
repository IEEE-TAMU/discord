const GroupMeBot = {
	bot_id: process.env.GROUPME_BOT_ID || (function() {
		throw new Error('The GROUPME_BOT_ID environment variable is required.');
	}
	)(),
	send: async function(message: string) {
		return fetch('https://api.groupme.com/v3/bots/post', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({
				text: message,
				bot_id: this.bot_id,
			}),
		}).catch(error => console.error('Error:', error));
	},
};

export default GroupMeBot;