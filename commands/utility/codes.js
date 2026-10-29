const {
	SlashCommandBuilder,
	PermissionFlagsBits,
	MessageFlags,
} = require("discord.js");
const axios = require("axios");
const { parse } = require("csv-parse");
const { Transform } = require("node:stream");
const { pipeline } = require("node:stream/promises");
const { Code, sequelize } = require("../../utils/database");

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
		),
	async execute(interaction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });

		if (interaction.options.getSubcommand() === "setup") {
			await setupDatabase(interaction);
			return;
		}

		await importCsv(interaction);
	},
};

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
