{pkgs ? import <nixpkgs> {} }:
pkgs.mkShellNoCC {
    nativeBuildInputs = builtins.attrValues {
        inherit (pkgs)
        nodejs;
    };
}