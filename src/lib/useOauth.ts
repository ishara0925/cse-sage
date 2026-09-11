import { useCallback, useEffect, useState } from 'react'
import { disconnect as oauthDisconnect, handleRedirectCallback, isConnected, startLogin } from './oauth'

export function useOauth() {
  const [connected, setConnected] = useState(isConnected())
  const [checkedRedirect, setCheckedRedirect] = useState(false)

  useEffect(() => {
    handleRedirectCallback().finally(() => {
      setConnected(isConnected())
      setCheckedRedirect(true)
    })
  }, [])

  const connect = useCallback(() => {
    void startLogin()
  }, [])

  const disconnect = useCallback(() => {
    oauthDisconnect()
    setConnected(false)
  }, [])

  return { connected, checkedRedirect, connect, disconnect }
}
