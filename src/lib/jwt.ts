// src/lib/jwt.ts
import jwt from 'jsonwebtoken';

export type JWTPayload = {
    id?: number | string;
    email?: string;
    nombre?: string;
    role?: string;  // preferible
    rol?: string;   // tu BD usa 'rol' — lo aceptamos también
    iat?: number;
    exp?: number;
    [k: string]: any;
};

const SECRET = process.env.JWT_SECRET;
if (!SECRET) {
    // Lanzar ahora evita errores silenciosos en runtime
    throw new Error('Environment variable JWT_SECRET is required');
}

/**
 * Firma un token JWT con el payload mínimo.
 * @param payload objeto con al menos { id, role }
 * @param expiresIn duración (ej. '2h', '1d', 3600)
 */
export function signToken(payload: Partial<JWTPayload>, expiresIn = '2h'): string {
    return jwt.sign(payload as object, SECRET, { expiresIn });
}

/**
 * Verifica y retorna el payload decodificado.
 * Lanza si el token no es válido o expiró.
 */
export function verifyToken<T = JWTPayload>(token: string): T {
    try {
        return jwt.verify(token, SECRET) as T;
    } catch (err) {
        // re-lanzamos el error para que el llamador decida cómo responder
        throw err;
    }
}
