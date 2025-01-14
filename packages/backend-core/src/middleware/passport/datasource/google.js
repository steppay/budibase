const google = require("../google")
const { Cookies } = require("../../../constants")
const { clearCookie, getCookie } = require("../../../utils")
const { getDB } = require("../../../db")
const environment = require("../../../environment")

async function preAuth(passport, ctx, next) {
  // get the relevant config
  const googleConfig = {
    clientID: environment.GOOGLE_CLIENT_ID,
    clientSecret: environment.GOOGLE_CLIENT_SECRET,
  }
  let callbackUrl = `${environment.PLATFORM_URL}/api/global/auth/datasource/google/callback`
  const strategy = await google.strategyFactory(googleConfig, callbackUrl)

  if (!ctx.query.appId || !ctx.query.datasourceId) {
    ctx.throw(400, "appId and datasourceId query params not present.")
  }

  return passport.authenticate(strategy, {
    scope: ["profile", "email", "https://www.googleapis.com/auth/spreadsheets"],
    accessType: "offline",
    prompt: "consent",
  })(ctx, next)
}

async function postAuth(passport, ctx, next) {
  // get the relevant config
  const config = {
    clientID: environment.GOOGLE_CLIENT_ID,
    clientSecret: environment.GOOGLE_CLIENT_SECRET,
  }

  let callbackUrl = `${environment.PLATFORM_URL}/api/global/auth/datasource/google/callback`
  const strategy = await google.strategyFactory(
    config,
    callbackUrl,
    (accessToken, refreshToken, profile, done) => {
      clearCookie(ctx, Cookies.DatasourceAuth)
      done(null, { accessToken, refreshToken })
    }
  )

  const authStateCookie = getCookie(ctx, Cookies.DatasourceAuth)

  return passport.authenticate(
    strategy,
    { successRedirect: "/", failureRedirect: "/error" },
    async (err, tokens) => {
      // update the DB for the datasource with all the user info
      const db = getDB(authStateCookie.appId)
      const datasource = await db.get(authStateCookie.datasourceId)
      if (!datasource.config) {
        datasource.config = {}
      }
      datasource.config.auth = { type: "google", ...tokens }
      await db.put(datasource)
      ctx.redirect(
        `/builder/app/${authStateCookie.appId}/data/datasource/${authStateCookie.datasourceId}`
      )
    }
  )(ctx, next)
}

exports.preAuth = preAuth
exports.postAuth = postAuth
