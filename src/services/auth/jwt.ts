import jwt from 'jsonwebtoken';
import config from '../../config/index.js';

interface TokenPayload {
    username: string;
    role: string;
    [key: string]: any;
}

export const generateToken = (payload: TokenPayload): string => {
    return jwt.sign(payload, config.admin.jwtSecret, { expiresIn: '24h' });
};

export const verifyToken = (token: string): any => {
    return jwt.verify(token, config.admin.jwtSecret);
};

// Hono auth middleware moved to admin.ts
// Kept for compatibility (Express deprecated warning)
export const authMiddleware = (req: any, res: any, next: () => void) => {
    console.warn('authMiddleware is deprecated for Express. Use Hono middleware instead.');
    const authHeader = req.headers?.authorization;
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;

    if (!token) {
        return res.status(401).json({ error: 'Token required' });
    }

    try {
        const decoded = verifyToken(token);
        req.user = decoded;
        next();
    } catch (error) {
        return res.status(401).json({ error: 'Invalid token' });
    }
};
