import { DataSource, EntityManager } from "typeorm";

/**
 * Executes a function within a database transaction.
 * @param dataSource The TypeORM DataSource.
 * @param fn The function to execute. Receives the transactional EntityManager.
 * @returns The result of the function.
 */
export async function withTransaction<T>(
    dataSource: DataSource,
    fn: (manager: EntityManager) => Promise<T>,
): Promise<T> {
    const queryRunner = dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
        const result = await fn(queryRunner.manager);
        await queryRunner.commitTransaction();
        return result;
    } catch (error) {
        // Rollback on any error
        if (queryRunner.isTransactionActive) {
            await queryRunner.rollbackTransaction();
        }
        throw error;
    } finally {
        await queryRunner.release();
    }
}
