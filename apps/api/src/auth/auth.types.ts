export type AuthenticatedUser = {
  id: string
  username: string
  role: 'user' | 'admin'
}

export type JwtPayload = {
  sub: string
  username: string
  role?: 'user' | 'admin'
}
