const { MessageFlags } = require("discord.js");
const { Code, sequelize } = require("../../utils/database");

module.exports = {
	cooldown: 0,
	data: {
		name: "get-key",
	},
	async execute(interaction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });

		await sequelize.query(
			"UPDATE `codes` SET `assigned_to_user_id` = $userId, `assigned_at` = CURRENT_TIMESTAMP WHERE `id` = (SELECT `id` FROM `codes` WHERE `assigned_to_user_id` IS NULL ORDER BY `id` LIMIT 1) AND NOT EXISTS (SELECT 1 FROM `codes` WHERE `assigned_to_user_id` = $userId)",
			{ bind: { userId: interaction.user.id } },
		);

		const assignment = await Code.findOne({
			where: { assignedToUserId: interaction.user.id },
		});
		const code = assignment?.code;

		if (!code) {
			await interaction.editReply("Sorry, all CD keys have been claimed.");
			return;
		}

		await interaction.editReply({
			content: `Your CD key is: ${code}`,
			allowedMentions: { parse: [] },
		});
	},
};
