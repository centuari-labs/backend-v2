export function createMockRepository() {
    return {
        find: jest.fn(),
        findOne: jest.fn(),
        save: jest.fn(),
        create: jest.fn(),
        count: jest.fn(),
        delete: jest.fn(),
        update: jest.fn(),
    };
}

export function createMockTokensService() {
    return {
        validateToken: jest.fn(),
        getActiveTokens: jest.fn(),
        isTokenSupported: jest.fn(),
    };
}

export function createMockNatsService() {
    return {
        publish: jest.fn(),
        subscribe: jest.fn(),
        connect: jest.fn(),
        disconnect: jest.fn(),
        isConnected: jest.fn(),
        getConnection: jest.fn(),
        onModuleInit: jest.fn(),
        onModuleDestroy: jest.fn(),
    };
}

export function createMockDatabaseService() {
    return {
        query: jest.fn(),
        queryOne: jest.fn(),
        insert: jest.fn(),
        getPool: jest.fn(),
        onModuleInit: jest.fn(),
        onModuleDestroy: jest.fn(),
    };
}

export function createMockViemService() {
    return {
        isValidAddress: jest.fn(),
        getClient: jest.fn(),
        generateWallet: jest.fn(),
    };
}

export function createMockPrivyService() {
    return {
        verify: jest.fn(),
        getUser: jest.fn(),
        getUserInfo: jest.fn(),
        getVerificationKey: jest.fn(),
    };
}

export function createMockExecutionContext(
    request: Record<string, unknown> = {},
) {
    const mockRequest = {
        headers: {},
        url: "/test",
        user: undefined,
        ...request,
    };

    return {
        switchToHttp: () => ({
            getRequest: () => mockRequest,
            getResponse: () => ({
                status: jest.fn().mockReturnThis(),
                json: jest.fn(),
                statusCode: 200,
            }),
        }),
        getHandler: jest.fn(),
        getClass: jest.fn(),
    };
}
