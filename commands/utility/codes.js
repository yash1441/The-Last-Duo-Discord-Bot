const {
	SlashCommandBuilder,
	PermissionFlagsBits,
	MessageFlags,
	ActionRowBuilder,
	ButtonBuilder,
	ButtonStyle,
} = require("discord.js");
const { QueryTypes } = require("sequelize");
const { Code, sequelize } = require("../../utils/database");
const clearAllButton = require("../../components/buttons/codes-clear-all");

module.exports = {
	category: "utility",
	data: new SlashCommandBuilder()
		.setName("codes")
		.setDescription("Manage CD keys")
		.setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
		.setDMPermission(false)
		.addSubcommand((subcommand) =>
			subcommand
				.setName("setup")
				.setDescription("Create the CD key database and table"),
		)
		.addSubcommand((subcommand) =>
			subcommand
				.setName("stats")
				.setDescription("Show CD key inventory statistics"),
		)
		.addSubcommand((subcommand) =>
			subcommand
				.setName("clear-user")
				.setDescription("Unassign all CD keys from a Discord user")
				.addUserOption((option) =>
					option
						.setName("user")
						.setDescription("The user whose key assignment to clear")
						.setRequired(true),
				),
		)
		.addSubcommand((subcommand) =>
			subcommand
				.setName("clear-all")
				.setDescription("Clear all user assignments after confirmation"),
		),
	async execute(interaction) {
		const subcommand = interaction.options.getSubcommand();

		if (subcommand === "clear-all") {
			await confirmClearAll(interaction);
		} else {
			await interaction.deferReply({ flags: MessageFlags.Ephemeral });

			if (subcommand === "setup") {
				await setupDatabase(interaction);
			} else if (subcommand === "stats") {
				await showStats(interaction);
			} else if (subcommand === "clear-user") {
				await clearUserAssignment(interaction);
			}
		}
	},
};

async function showStats(interaction) {
	await sequelize.authenticate();

	const [stats] = await sequelize.query(
		"SELECT COUNT(*) AS total, COALESCE(SUM(CASE WHEN assigned_to_user_id IS NOT NULL THEN 1 ELSE 0 END), 0) AS used, COALESCE(SUM(CASE WHEN assigned_to_user_id IS NULL THEN 1 ELSE 0 END), 0) AS unused, COUNT(DISTINCT assigned_to_user_id) AS unique_users, (SELECT COUNT(*) FROM (SELECT code FROM codes GROUP BY code HAVING COUNT(*) > 1) AS duplicate_codes) AS duplicate_groups, COALESCE((SELECT SUM(duplicate_count - 1) FROM (SELECT COUNT(*) AS duplicate_count FROM codes GROUP BY code HAVING COUNT(*) > 1) AS duplicate_rows), 0) AS duplicate_entries FROM codes",
		{ type: QueryTypes.SELECT },
	);

	await interaction.editReply(
		[
			"**CD key statistics**",
			`Total keys: ${Number(stats.total)}`,
			`Used keys: ${Number(stats.used)}`,
			`Unused keys: ${Number(stats.unused)}`,
			`Unique users assigned: ${Number(stats.unique_users)}`,
			`Duplicate key groups: ${Number(stats.duplicate_groups)}`,
			`Extra duplicate entries: ${Number(stats.duplicate_entries)}`,
		].join("\n"),
	);
}

async function clearUserAssignment(interaction) {
	await sequelize.authenticate();
	const user = interaction.options.getUser("user", true);
	const [clearedCount] = await Code.update(
		{ assignedToUserId: null, assignedAt: null },
		{ where: { assignedToUserId: user.id } },
	);

	await interaction.editReply(
		clearedCount > 0
			? `Cleared ${clearedCount} assignment(s) for ${user.tag}. The CD key(s) remain in the inventory.`
			: `${user.tag} has no assigned CD keys.`,
	);
}

async function confirmClearAll(interaction) {
	const token = clearAllButton.createConfirmation(interaction.user.id);
	const row = new ActionRowBuilder().addComponents(
		new ButtonBuilder()
			.setCustomId(`codes-clear-all:confirm:${token}`)
			.setLabel("Clear all assignments")
			.setStyle(ButtonStyle.Danger),
		new ButtonBuilder()
			.setCustomId(`codes-clear-all:cancel:${token}`)
			.setLabel("Cancel")
			.setStyle(ButtonStyle.Secondary),
	);

	await interaction.reply({
		content:
			"This clears every user's CD key assignment, but keeps all CD keys in the inventory. Confirm within 60 seconds.",
		components: [row],
		flags: MessageFlags.Ephemeral,
	});
}

async function setupDatabase(interaction) {
	await sequelize.authenticate();
	await sequelize.sync();
	await interaction.editReply(
		`The CD key database is ready at \`${sequelize.options.storage}\`.`,
	);
}
