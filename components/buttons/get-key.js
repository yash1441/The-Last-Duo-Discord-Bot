const { MessageFlags } = require("discord.js");
require("dotenv").config();

module.exports = {
	cooldown: 10,
	data: {
		name: "get-key",
	},
	async execute(interaction) {
		// Logic to pull key from database here
		await interaction.reply({
			content: "Here is your key!",
			flags: MessageFlags.Ephemeral,
		});
	},
};
