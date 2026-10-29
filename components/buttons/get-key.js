const { MessageFlags } = require("discord.js");
const { UniqueConstraintError } = require("sequelize");
const { Code, sequelize } = require("../../utils/database");

module.exports = {
	cooldown: 0,
	data: {
		name: "get-key",
	},
	async execute(interaction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });

		let code;

		try {
			code = await sequelize.transaction(async (transaction) => {
				const existingAssignment = await Code.findOne({
					where: { assignedToUserId: interaction.user.id },
					transaction,
				});

				if (existingAssignment) {
					return existingAssignment.code;
				}

				const availableCode = await Code.findOne({
					where: { assignedToUserId: null },
					order: [["id", "ASC"]],
					transaction,
					lock: transaction.LOCK.UPDATE,
				});

				if (!availableCode) {
					return null;
				}

				await availableCode.update(
					{
						assignedToUserId: interaction.user.id,
						assignedAt: new Date(),
					},
					{ transaction },
				);

				return availableCode.code;
			});
		} catch (error) {
			if (!(error instanceof UniqueConstraintError)) {
				throw error;
			}

			const existingAssignment = await Code.findOne({
				where: { assignedToUserId: interaction.user.id },
			});

			if (!existingAssignment) {
				throw error;
			}

			code = existingAssignment.code;
		}

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
