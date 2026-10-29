const {
	SlashCommandBuilder,
	PermissionFlagsBits,
	MessageFlags,
	ActionRowBuilder,
	ButtonBuilder,
	ButtonStyle,
} = require("discord.js");
const { QueryTypes } = require("sequelize");
const axios = require("axios");
const { parse } = require("csv-parse");
const { Transform } = require("node:stream");
const { pipeline } = require("node:stream/promises");
const { Code, sequelize } = require("../../utils/database");
const clearAllButton = require("../../components/buttons/codes-clear-all");

const batchSize = 500;
const maxCsvSize = 10 * 1024 * 1024;

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
				.setName("import")
				.setDescription("Import CD keys from a CSV file")
				.addAttachmentOption((option) =>
					option
						.setName("csv")
						.setDescription(
							"CSV file with one CD key per row in the first column",
						)
						.setRequired(true),
				)
				.addBooleanOption((option) =>
					option
						.setName("has-header")
						.setDescription("Whether the first CSV row is a header")
						.setRequired(false),
				),
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
			} else if (subcommand === "import") {
				await importCsv(interaction);
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

async function importCsv(interaction) {
	const attachment = interaction.options.getAttachment("csv", true);

	if (attachment.size > maxCsvSize) {
		await interaction.editReply("The CSV must be 10 MB or smaller.");
		return;
	}

	await sequelize.authenticate();
	await sequelize.sync();

	const response = await axios.get(attachment.url, {
		responseType: "stream",
		timeout: 30_000,
		maxRedirects: 3,
	});

	let bytesReceived = 0;
	let rowsRead = 0;
	let uniqueCodes = 0;
	let emptyRows = 0;
	let duplicateRows = 0;
	let rows = [];
	let headerPending = interaction.options.getBoolean("has-header") ?? false;
	const seenCodes = new Set();

	const sizeLimit = new Transform({
		transform(chunk, encoding, callback) {
			bytesReceived += chunk.length;
			if (bytesReceived > maxCsvSize) {
				callback(new Error("The CSV exceeds the 10 MB size limit."));
				return;
			}
			callback(null, chunk);
		},
	});

	async function insertBatch() {
		if (rows.length === 0) {
			return;
		}

		await Code.bulkCreate(rows, {
			ignoreDuplicates: true,
			validate: true,
		});
		rows = [];
	}

	const parser = parse({ bom: true, skip_empty_lines: true });
	const download = pipeline(response.data, sizeLimit, parser);
	download.catch(() => {});

	try {
		for await (const record of parser) {
			if (headerPending) {
				headerPending = false;
				continue;
			}

			rowsRead += 1;
			const code = record[0]?.trim();

			if (!code) {
				emptyRows += 1;
				continue;
			}

			if (code.length > 255) {
				throw new Error(
					`CSV row ${rowsRead} contains a key longer than the 255-character database limit.`,
				);
			}

			if (seenCodes.has(code)) {
				duplicateRows += 1;
				continue;
			}

			seenCodes.add(code);
			uniqueCodes += 1;
			rows.push({ code });

			if (rows.length >= batchSize) {
				await insertBatch();
			}
		}

		await download;
		await insertBatch();
	} catch (error) {
		response.data.destroy();
		await download.catch(() => {});
		throw error;
	}

	await interaction.editReply(
		`CSV import complete. Rows read: ${rowsRead}; unique keys in the file: ${uniqueCodes}; empty rows: ${emptyRows}; duplicate keys in the file: ${duplicateRows}. Keys already in the database were skipped.`,
	);
}
