import { expect, it } from "vitest";
import { testDB } from "./db-helper.js";
import { transaction } from "../src/db.js";

it("rolls back a failed transaction on a reserved connection and permits reuse", async () => {
  const fixture = await testDB();
  const connection = await fixture.db.reserve();
  try {
    await connection.unsafe("create table transaction_probe (value int)");
    await expect(
      transaction(connection, async (tx) => {
        await tx.unsafe("insert into transaction_probe values (1)");
        throw new Error("abort");
      }),
    ).rejects.toThrow("abort");
    expect(await connection.unsafe("select * from transaction_probe")).toEqual(
      [],
    );
    await transaction(connection, async (tx) => {
      await tx.unsafe("insert into transaction_probe values (2)");
    });
    expect(await connection.unsafe("select * from transaction_probe")).toEqual([
      { value: 2 },
    ]);
  } finally {
    connection.release();
    await fixture.close();
  }
});
