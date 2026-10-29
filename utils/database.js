const { DataTypes, Sequelize } = require("sequelize");

const requiredEnvironmentVariables = ["DB_NAME", "DB_USER"];
const missingEnvironmentVariables = requiredEnvironmentVariables.filter(
	(variable) => !process.env[variable],
);

if (missingEnvironmentVariables.length > 0) {
	throw new Error(
		`Missing required database environment variables: ${missingEnvironmentVariables.join(", ")}`,
	);
}

const sequelize = new Sequelize(
	process.env.DB_NAME,
	process.env.DB_USER,
	process.env.DB_PASSWORD ?? "",
	{
		host: process.env.DB_HOST || "localhost",
		port: Number(process.env.DB_PORT || 3306),
		dialect: "mysql",
		logging: false,
		pool: {
			max: 10,
			min: 0,
			acquire: 30_000,
			idle: 10_000,
		},
	},
);

const Code = sequelize.define(
	"Code",
	{
		id: {
			type: DataTypes.BIGINT.UNSIGNED,
			autoIncrement: true,
			primaryKey: true,
		},
		code: {
			type: DataTypes.STRING(255),
			allowNull: false,
			unique: true,
		},
		assignedToUserId: {
			type: DataTypes.STRING(20),
			allowNull: true,
			unique: true,
			field: "assigned_to_user_id",
		},
		assignedAt: {
			type: DataTypes.DATE,
			allowNull: true,
			field: "assigned_at",
		},
	},
	{
		tableName: "codes",
		timestamps: false,
	},
);

module.exports = { Code, sequelize };
