const {
	SlashCommandBuilder,
	EmbedBuilder,
	ButtonBuilder,
	ButtonStyle,
	ActionRowBuilder,
	PermissionFlagsBits,
	MessageFlags,
} = require("discord.js");

module.exports = {
	cooldown: 60,
	category: "server",
	data: new SlashCommandBuilder()
		.setName("register")
		.setDescription("Registration related commands")
		.setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
		.setDMPermission(false)
		.addSubcommand((subcommand) =>
			subcommand
				.setName("setup")
				.setDescription("Setup redeem key embed and button"),
		),
	async execute(interaction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });

		const embed = new EmbedBuilder()
			.setTitle("CDK Redemption")
			.setColor(process.env.EMBED_COLOR)
			.setDescription(
				"Click the button below to redeem your CDK and get your rewards!",
			)
			.setFooter({
				text: "The Last Duo",
				iconURL: "https://i.ibb.co/mrXmdt8Z/image.png",
			});

		const getKeyButton = new ButtonBuilder()
			.setLabel("Get Key")
			.setStyle(ButtonStyle.Primary)
			.setCustomId("get-key")
			.setEmoji("🔑");

		const row = new ActionRowBuilder().addComponents(getKeyButton);

		await interaction.channel.send({ embeds: [embed], components: [row] });

		await interaction.editReply({
			content: "Redeem key embed and button setup successfully!",
		});
	},
};
