import { Request, Response, NextFunction } from 'express'
import { timingSafeEqual } from 'crypto'

const ADMIN_EXPORT_USERNAME = process.env.ADMIN_EXPORT_USERNAME || 'admin'
const ADMIN_EXPORT_PASSWORD = process.env.ADMIN_EXPORT_PASSWORD

const secretsMatch = (provided: string, expected: string): boolean => {
  const providedBuffer = Buffer.from(provided)
  const expectedBuffer = Buffer.from(expected)
  return (
    providedBuffer.length === expectedBuffer.length &&
    timingSafeEqual(providedBuffer, expectedBuffer)
  )
}

const challenge = (res: Response, message: string) => {
  res.setHeader('WWW-Authenticate', 'Basic realm="givbacks-admin"')
  return res.status(401).send({ message })
}

/**
 * HTTP Basic Auth guard for the GIVbacks admin/reporting endpoints.
 * Many of these expose donor names/emails or operationally sensitive data, so
 * they must not be public. Fails closed when ADMIN_EXPORT_PASSWORD is not
 * configured.
 *
 * Applied to every route in src/index.ts, including the /api-docs UI. This is
 * internal tooling with no public consumers (neither giveth-v6-core nor the
 * frontend call it), so there are no anonymous endpoints. Any new endpoint must
 * include this guard.
 */
export const adminExportAuth = (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  if (!ADMIN_EXPORT_PASSWORD) {
    console.log('ADMIN_EXPORT_PASSWORD is not set; refusing admin export request')
    return challenge(res, 'Admin export auth is not configured')
  }

  const header = req.headers.authorization || ''
  const [scheme, encoded] = header.split(' ')
  if (!scheme || scheme.toLowerCase() !== 'basic' || !encoded) {
    return challenge(res, 'Authentication required')
  }

  const decoded = Buffer.from(encoded, 'base64').toString('utf8')
  const separatorIndex = decoded.indexOf(':')
  const username = separatorIndex === -1 ? decoded : decoded.slice(0, separatorIndex)
  const password = separatorIndex === -1 ? '' : decoded.slice(separatorIndex + 1)

  if (
    username === ADMIN_EXPORT_USERNAME &&
    secretsMatch(password, ADMIN_EXPORT_PASSWORD)
  ) {
    return next()
  }

  return challenge(res, 'Invalid credentials')
}
