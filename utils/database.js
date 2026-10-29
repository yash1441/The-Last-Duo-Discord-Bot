const path = require("node:path");
const { DataTypes, Sequelize } = require("sequelize");

const storage = path.resolve(
	process.env.SQLITE_PATH || path.join(__dirname, "..", "database.sqlite"),
);
const sequelize = new Sequelize({
	dialect: "sqlite",
	storage,
	logging: false,
	pool: {
		max: 1,
		min: 0,
	},
});

const Code = sequelize.define(
	"Code",
	{
		id: {
			type: DataTypes.INTEGER,
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

module.exports = { Code, sequelize, storage };
