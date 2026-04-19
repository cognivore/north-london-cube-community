{
  description = "Cubehall - MTG cube draft community management";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }:
    flake-utils.lib.eachSystem [
      "x86_64-linux"
      "aarch64-linux"
      "aarch64-darwin"
      "x86_64-darwin"
    ] (system:
      let
        pkgs = import nixpkgs { inherit system; };
        isDarwin = pkgs.stdenv.isDarwin;
      in
      {
        devShells.default = pkgs.mkShell {
          buildInputs = with pkgs; [
            nodejs_22
            pnpm
          ] ++ pkgs.lib.optionals isDarwin [
            darwin.cctools
          ];

          shellHook = ''
            echo "Cubehall dev environment ready"
            echo "Node: $(node --version)"
            echo "pnpm: $(pnpm --version)"
          '';
        };
      }
    );
}
