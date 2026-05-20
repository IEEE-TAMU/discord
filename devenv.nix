{
  pkgs,
  lib,
  config,
  ...
}:
{
  # https://devenv.sh/services/
  services.mysql = {
    enable = true;
    initialDatabases = [
      { name = "discord"; }
    ];
    # not working?
    ensureUsers = [
      {
        name = "discord";
        password = "discord";
        ensurePermissions = {
          "discord.*" = "ALL PRIVILEGES";
        };
      }
    ];
  };

  # See full reference at https://devenv.sh/reference/options/
}
