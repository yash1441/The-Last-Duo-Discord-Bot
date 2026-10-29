const { randomUUID } = require("node:crypto");
const { MessageFlags, PermissionFlagsBits } = require("discord.js");
const { Op } = require("sequelize");
const { Code, sequelize } = require("../../utils/database");

const confirmationLifetime = 60_000;
const pendingConfirmations = new Map();

module.exports = {
	cooldown: 0,
	data: {
		name: "codes-clear-all",
	},
	matches(customId) {
		return /^codes-clear-all:(confirm|cancel):[0-9a-f-]{36}$/.test(customId);
	},
	createConfirmation(userId) {
		const token = randomUUID();
		const timeout = setTimeout(() => {
			pendingConfirmations.delete(token);
		}, confirmationLifetime);
		timeout.unref?.();
		pendingConfirmations.set(token, {
			userId,
			expiresAt: Date.now() + confirmationLifetime,
			timeout,
			processing: false,
		});
		return token;
	},
	async execute(interaction) {
		const [, action, token] = interaction.customId.split(":");
		const confirmation = pendingConfirmations.get(token);

		if (!confirmation || confirmation.expiresAt <= Date.now()) {
			if (confirmation) {
				clearTimeout(confirmation.timeout);
				pendingConfirmations.delete(token);
			}
			await interaction.reply({
				content: "This confirmation has expired or was already used.",
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		if (interaction.user.id !== confirmation.userId) {
			await interaction.reply({
				content:
					"Only the administrator who started this confirmation can use it.",
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		if (
			!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)
		) {
			await interaction.reply({
				content: "Administrator permission is required to manage CD keys.",
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		if (confirmation.processing) {
			await interaction.reply({
				content: "This confirmation is already being processed.",
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		if (action === "cancel") {
			clearTimeout(confirmation.timeout);
			pendingConfirmations.delete(token);
			await interaction.update({
				content: "Cancelled. No CD key assignments were cleared.",
				components: [],
			});
			return;
		}

		confirmation.processing = true;

		try {
			await sequelize.authenticate();
			const [clearedCount] = await Code.update(
				{ assignedToUserId: null, assignedAt: null },
				{ where: { assignedToUserId: { [Op.ne]: null } } },
			);
			clearTimeout(confirmation.timeout);
			pendingConfirmations.delete(token);
			await interaction.update({
				content: `Cleared ${clearedCount} CD key assignment(s). All CD keys remain in the inventory.`,
				components: [],
			});
		} catch (error) {
			confirmation.processing = false;
			throw error;
		}
	},
};
